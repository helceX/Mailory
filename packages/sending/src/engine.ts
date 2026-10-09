import { findCoveringDomain, domainOfEmail } from "@mailory/core";
import {
  campaignHealth,
  checkEntitlement,
  claimRecipients,
  ensureCampaignLinks,
  completeIfDone,
  countSentSince,
  getContactForSend,
  getOrgSendLimit,
  getOrganization,
  haltCampaign,
  isSuppressedNow,
  listDailyLimited,
  listDueCampaigns,
  listSendingCampaigns,
  listSenderDomains,
  countContactSendsSince,
  markRecipientFailed,
  markRecipientRetry,
  markRecipientSent,
  materializeRecipients,
  releaseRecipients,
  resolveAudienceFilter,
  resumeCampaign,
  startCampaignSending,
  getCampaignStatus,
  asOrganizationId,
  type Campaign,
  type CampaignRecipient,
  type CampaignSnapshot,
  type Database,
} from "@mailory/db";
import type { EmailTransport } from "@mailory/email";
import { renderMessage } from "./message";

export type EngineDeps = {
  db: Database;
  transport: EmailTransport;
  appUrl: string;
  /** Signs unsubscribe links; the web app verifies with the same secret. */
  secret: string;
  now?: () => Date;
  /** Emails per second per process (SES accounts start at 14/s). */
  ratePerSecond?: number;
  concurrency?: number;
  batchSize?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Restrict the engine to one organization (tests; a shared database holds other tenants' campaigns). */
  scope?: { organizationId?: string };
  log?: (message: string, data?: unknown) => void;
};

export const MAX_ATTEMPTS = 5;
/** Auto-pause thresholds, evaluated once enough mail has gone out for the rates to mean something. */
export const HEALTH = {
  minSent: 100,
  maxBounceRate: 0.1,
  maxComplaintRate: 0.005,
} as const;
/** Errors that mean "stop the whole campaign", not "this recipient is bad". */
const ACCOUNT_LEVEL = new Set([
  "AccountSuspendedException",
  "SendingPausedException",
  "MailFromDomainNotVerifiedException",
  "ConfigurationSetSendingPausedException",
]);

const clock = (d: EngineDeps) => (d.now ?? (() => new Date()))();
const utcDayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);
}

// ---- dispatch --------------------------------------------------------------------------------------

/** scheduled → sending for every due campaign, freezing its recipient list. */
export async function dispatchDue(deps: EngineDeps) {
  const now = clock(deps);
  let started = 0;
  // Drain the due set: a backlog larger than one page must not starve campaigns behind it.
  for (;;) {
    const due = await listDueCampaigns(deps.db, now, 20, deps.scope);
    let claimed = 0;
    for (const c of due) {
      const org = asOrganizationId(c.organizationId);
      const row = await startCampaignSending(deps.db, org, c.id, now);
      if (!row) continue; // another dispatcher won
      claimed++;
      started++;
      const audience = await resolveAudienceFilter(deps.db, org, row.audience);
      if (!audience.filter || !audience.exists) {
        await haltCampaign(deps.db, org, row.id, "failed", "audience_missing", now);
        continue;
      }
      const n = await materializeRecipients(deps.db, org, row.id, audience.filter, now);
      deps.log?.("campaign started", { campaignId: row.id, recipients: n });
      if (n === 0) await completeIfDone(deps.db, org, row.id, now);
    }
    if (claimed === 0 || due.length < 20) break;
  }
  return { started };
}

/** Campaigns paused only by the daily cap continue automatically once a new day (or a raised cap) allows it. */
export async function resumeDailyLimited(deps: EngineDeps) {
  const now = clock(deps);
  let resumed = 0;
  for (const c of await listDailyLimited(deps.db, 50, deps.scope)) {
    const org = asOrganizationId(c.organizationId);
    const [limit, sent, plan, organization] = await Promise.all([
      getOrgSendLimit(deps.db, org),
      countSentSince(deps.db, org, utcDayStart(now)),
      checkEntitlement(deps.db, org, "emails_per_month", 0, now),
      getOrganization(deps.db, org),
    ]);
    const planOk = plan.remaining === null || plan.remaining > 0;
    if (
      limit - sent > 0 &&
      planOk &&
      !organization?.suspendedAt &&
      (await resumeCampaign(deps.db, org, c.id, now))
    )
      resumed++;
  }
  return { resumed };
}

// ---- sending ---------------------------------------------------------------------------------------

export type BatchResult = {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  halted: string | null;
  claimed: number;
};

/** One bounded round of work for one campaign. Safe to run concurrently with other workers. */
export async function sendBatch(
  deps: EngineDeps,
  campaign: Campaign,
): Promise<BatchResult> {
  const out: BatchResult = {
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    halted: null,
    claimed: 0,
  };
  const now = clock(deps);
  const org = asOrganizationId(campaign.organizationId);
  const snapshot = campaign.snapshot as CampaignSnapshot | null;
  const halt = async (reason: string) => {
    out.halted = reason;
    await haltCampaign(deps.db, org, campaign.id, "paused", reason, clock(deps));
    return out;
  };
  if (!snapshot) {
    await haltCampaign(deps.db, org, campaign.id, "failed", "missing_snapshot", now);
    out.halted = "missing_snapshot";
    return out;
  }

  // The sender's domain must still be verified at send time, not only when the campaign was approved.
  const domains = await listSenderDomains(deps.db, org);
  const fromDomain = domainOfEmail(snapshot.sender.fromEmail);
  const cover = fromDomain
    ? findCoveringDomain(
        domains.filter((d) => d.status === "verified"),
        fromDomain,
      )
    : null;
  if (!cover) return halt("sender_unverified");

  const orgRow = await getOrganization(deps.db, org); // null once the workspace has been deleted
  if (!orgRow) return halt("org_deleted");
  if (orgRow.suspendedAt) return halt("org_suspended");

  const [limit, sentToday, plan] = await Promise.all([
    getOrgSendLimit(deps.db, org),
    countSentSince(deps.db, org, utcDayStart(now)),
    checkEntitlement(deps.db, org, "emails_per_month", 0, now),
  ]);
  if (plan.remaining !== null && plan.remaining <= 0) return halt("plan_limit");
  const room = Math.min(limit - sentToday, plan.remaining ?? Number.MAX_SAFE_INTEGER);
  if (room <= 0) return halt("daily_limit");

  const batch = await claimRecipients(
    deps.db,
    org,
    campaign.id,
    Math.min(deps.batchSize ?? 50, room),
    now,
  );
  out.claimed = batch.length;
  if (batch.length === 0) {
    await completeIfDone(deps.db, org, campaign.id, now);
    return out;
  }

  const linkCache = new Map<string, string>();
  const resolveLinks = async (urls: string[]) => {
    const missing = urls.filter((u) => !linkCache.has(u));
    if (missing.length > 0)
      for (const [url, id] of await ensureCampaignLinks(
        deps.db,
        org,
        campaign.id,
        missing,
      ))
        linkCache.set(url, id);
    return new Map(
      urls.filter((u) => linkCache.has(u)).map((u) => [u, linkCache.get(u)!]),
    );
  };
  const organization = await getOrganization(deps.db, org);
  const orgName = organization?.name ?? "";
  // Fatigue shield: campaigns respect the per-contact weekly cap; automation steps are exempt (an onboarding
  // sequence must not be starved by newsletters) but still COUNT toward it.
  const weeklyCap =
    campaign.kind === "campaign" ? (organization?.contactWeeklyCap ?? null) : null;

  const rate = deps.ratePerSecond ?? 14;
  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 4, rate));
  const gap = (1000 * concurrency) / rate;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const unsent: string[] = [];
  let next = 0;
  let accountBlocked: string | null = null;

  async function one(r: CampaignRecipient) {
    const started = Date.now();
    if (accountBlocked || out.halted) {
      unsent.push(r.id);
      return;
    }
    const contact = r.contactId
      ? await getContactForSend(deps.db, org, r.contactId)
      : null;
    if (!contact) {
      await markRecipientFailed(deps.db, org, r.id, "skipped", "contact_deleted");
      out.skipped++;
      return;
    }
    // Re-checked per message: an unsubscribe or suppression since materialisation must always win.
    if (
      contact.status !== "subscribed" ||
      (await isSuppressedNow(deps.db, org, r.email))
    ) {
      await markRecipientFailed(deps.db, org, r.id, "skipped", "no_longer_subscribed");
      out.skipped++;
      return;
    }

    if (weeklyCap !== null) {
      const recent = await countContactSendsSince(
        deps.db,
        org,
        r.contactId!,
        new Date(clock(deps).getTime() - 7 * 86_400_000),
      );
      if (recent >= weeklyCap) {
        await markRecipientFailed(deps.db, org, r.id, "skipped", "frequency_cap");
        out.skipped++;
        return;
      }
    }

    const message = await renderMessage({
      campaign,
      snapshot: snapshot!,
      recipient: { id: r.id, email: r.email },
      contact,
      orgName,
      appUrl: deps.appUrl,
      secret: deps.secret,
      tracking: { resolveLinks },
    });

    const result = await deps.transport.send({
      from: { name: snapshot!.sender.fromName, email: snapshot!.sender.fromEmail },
      to: r.email,
      replyTo: snapshot!.sender.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: {
        "List-Unsubscribe": `<${deps.appUrl}/api/unsubscribe/${message.unsubscribeToken}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: { campaign_id: campaign.id, recipient_id: r.id },
    });

    if (result.ok) {
      await markRecipientSent(deps.db, org, r.id, result.messageId, clock(deps));
      out.sent++;
    } else if (ACCOUNT_LEVEL.has(result.code)) {
      accountBlocked = result.code;
      unsent.push(r.id);
    } else if (result.retryable && r.attempts < MAX_ATTEMPTS) {
      await markRecipientRetry(
        deps.db,
        org,
        r.id,
        `${result.code}: ${result.message}`,
        new Date(clock(deps).getTime() + backoffMs(r.attempts)),
      );
      out.retried++;
    } else {
      await markRecipientFailed(
        deps.db,
        org,
        r.id,
        "failed",
        `${result.code}: ${result.message}`,
      );
      out.failed++;
    }
    const spent = Date.now() - started;
    if (spent < gap) await sleep(gap - spent);
  }

  async function worker() {
    for (let i = next++; i < batch.length; i = next++) {
      // A pause/cancel issued while the batch runs stops the remaining rows of it.
      if (
        i > 0 &&
        i % 10 === 0 &&
        (await getCampaignStatus(deps.db, org, campaign.id)) !== "sending"
      )
        out.halted = out.halted ?? "stopped";
      await one(batch[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batch.length) }, worker),
  );

  await releaseRecipients(deps.db, org, unsent);
  if (accountBlocked) return halt(`provider_${accountBlocked}`);

  const verdict = await evaluateHealth(deps, campaign);
  if (verdict) return halt(verdict);
  if (!out.halted) await completeIfDone(deps.db, org, campaign.id, clock(deps));
  return out;
}

/** Pauses a campaign whose bounce or complaint rate would damage the sending domain's reputation. */
export async function evaluateHealth(
  deps: Pick<EngineDeps, "db">,
  campaign: Pick<Campaign, "id" | "organizationId">,
): Promise<string | null> {
  const h = await campaignHealth(
    deps.db,
    asOrganizationId(campaign.organizationId),
    campaign.id,
  );
  if (h.sent < HEALTH.minSent) return null;
  if (h.complained / h.sent > HEALTH.maxComplaintRate) return "complaint_rate";
  if (h.bounced / h.sent > HEALTH.maxBounceRate) return "bounce_rate";
  return null;
}

/** One scheduler tick: start what is due, resume what the cap released, push every sending campaign forward. */
export async function tick(deps: EngineDeps, budgetMs = 45_000) {
  const startedAt = Date.now();
  const d = await dispatchDue(deps);
  const r = await resumeDailyLimited(deps);
  let sent = 0;
  for (const c of await listSendingCampaigns(deps.db, 50, deps.scope)) {
    let current = c;
    while (Date.now() - startedAt < budgetMs) {
      const res = await sendBatch(deps, current);
      sent += res.sent;
      if (res.halted || res.claimed === 0) break;
      const fresh = await getCampaignStatus(
        deps.db,
        asOrganizationId(c.organizationId),
        c.id,
      );
      if (fresh !== "sending") break;
      current = { ...current };
    }
  }
  return { ...d, ...r, sent };
}
