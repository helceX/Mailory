import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { CampaignAudience } from "@mailory/core/shared";
import type { Database, OrganizationId } from "../index";
import {
  campaignRecipients,
  campaigns,
  contacts,
  emailEvents,
  type Campaign,
} from "../schema/index";
import { getList, getSegment, listTags, addSuppressions } from "./audience";
import { contactWhere, type ContactFilter } from "./contacts";

/** Audience → contact filter, shared by the readiness count (web) and recipient materialisation (worker). */
export async function resolveAudienceFilter(
  db: Database,
  organizationId: OrganizationId,
  audience: CampaignAudience | null,
): Promise<{ filter: ContactFilter | null; exists: boolean }> {
  if (!audience) return { filter: null, exists: false };
  switch (audience.kind) {
    case "all":
      return { filter: {}, exists: true };
    case "list": {
      const list = await getList(db, organizationId, audience.id);
      return { filter: { listId: audience.id }, exists: Boolean(list) };
    }
    case "tag": {
      const tags = await listTags(db, organizationId);
      return {
        filter: { tagId: audience.id },
        exists: tags.some((t) => t.id === audience.id),
      };
    }
    case "segment": {
      const segment = await getSegment(db, organizationId, audience.id);
      return {
        filter: segment
          ? { segment: segment.definition as NonNullable<ContactFilter["segment"]> }
          : null,
        exists: Boolean(segment),
      };
    }
  }
}

// ---- starting a campaign ---------------------------------------------------------------------------

/** Cross-tenant on purpose: the dispatcher scans every organization's due campaigns. */
export type Scope = { organizationId?: string };
const inScope = (scope: Scope) =>
  scope.organizationId ? eq(campaigns.organizationId, scope.organizationId) : undefined;

export async function listDueCampaigns(
  db: Database,
  now: Date,
  limit = 20,
  scope: Scope = {},
) {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, "scheduled"),
        lte(campaigns.scheduledAt, now),
        inScope(scope),
      ),
    )
    .orderBy(campaigns.scheduledAt)
    .limit(limit);
}

/** Cross-tenant: campaigns the engine should be pushing right now. */
export async function listSendingCampaigns(
  db: Database,
  limit = 50,
  scope: Scope = {},
) {
  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.status, "sending"), inScope(scope)))
    .orderBy(campaigns.startedAt)
    .limit(limit);
}

/** Cross-tenant: campaigns the daily cap paused; they resume on their own when the cap allows. */
export async function listDailyLimited(db: Database, limit = 50, scope: Scope = {}) {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, "paused"),
        eq(campaigns.haltReason, "daily_limit"),
        inScope(scope),
      ),
    )
    .limit(limit);
}

export async function resumeCampaign(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  now: Date,
) {
  const [row] = await db
    .update(campaigns)
    .set({ status: "sending", haltReason: null, updatedAt: now })
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, campaignId),
        eq(campaigns.status, "paused"),
      ),
    )
    .returning();
  return row ?? null;
}

/** CAS: two dispatchers racing for the same campaign — exactly one gets the row. */
export async function startCampaignSending(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  now: Date,
) {
  const [row] = await db
    .update(campaigns)
    .set({ status: "sending", startedAt: now, updatedAt: now })
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, id),
        eq(campaigns.status, "scheduled"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Freezes who receives the campaign: subscribed, not suppressed, right now. One INSERT … SELECT, idempotent via
 * UNIQUE(campaign_id, contact_id) so a restarted dispatcher never duplicates recipients.
 */
export async function materializeRecipients(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  filter: ContactFilter,
  now: Date,
) {
  const result = await db.execute(sql`
    insert into campaign_recipients (organization_id, campaign_id, contact_id, email, next_attempt_at)
    select contacts.organization_id, ${campaignId}::uuid, contacts.id, contacts.email, ${now}
      from contacts
     where ${contactWhere(organizationId, { ...filter, status: "subscribed" })}
       and not exists (select 1 from suppressions s where s.organization_id = ${organizationId}::uuid and s.email = contacts.email)
    on conflict do nothing`);
  const rows = { length: result.rowCount ?? 0 };
  return rows.length;
}

// ---- the work queue --------------------------------------------------------------------------------

export const STALE_CLAIM_MS = 10 * 60_000;

/**
 * Takes up to `limit` recipients for sending. `FOR UPDATE SKIP LOCKED` lets several workers pull from the same
 * campaign without ever receiving the same row; a claim abandoned by a crashed worker becomes claimable again.
 */
export async function claimRecipients(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  limit: number,
  now: Date,
) {
  const stale = new Date(now.getTime() - STALE_CLAIM_MS);
  const result = await db.execute<{ id: string }>(sql`
    update campaign_recipients r
       set status = 'sending', claimed_at = ${now}, attempts = r.attempts + 1
     where r.id in (
       select id from campaign_recipients
        where campaign_id = ${campaignId}::uuid
          and organization_id = ${organizationId}::uuid
          and ((status = 'queued' and next_attempt_at <= ${now})
               or (status = 'sending' and claimed_at < ${stale}))
        order by next_attempt_at
        limit ${limit}
        for update skip locked)
    returning r.id`);
  const ids = result.rows.map((r) => r.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        inArray(campaignRecipients.id, ids),
      ),
    );
}

export async function getContactForSend(
  db: Database,
  organizationId: OrganizationId,
  contactId: string,
) {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)))
    .limit(1);
  return row ?? null;
}

export async function isSuppressedNow(
  db: Database,
  organizationId: OrganizationId,
  email: string,
) {
  const r = await db.execute<{ n: number }>(
    sql`select 1 as n from suppressions where organization_id = ${organizationId}::uuid and email = ${email} limit 1`,
  );
  return r.rows.length > 0;
}

type Mark = { organizationId: OrganizationId; id: string };
const whereRecipient = (m: Mark) =>
  and(
    eq(campaignRecipients.organizationId, m.organizationId),
    eq(campaignRecipients.id, m.id),
  );

export async function markRecipientSent(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  messageId: string,
  now: Date,
) {
  await db
    .update(campaignRecipients)
    .set({ status: "sent", providerMessageId: messageId, sentAt: now, lastError: null })
    .where(
      and(
        whereRecipient({ organizationId, id }),
        eq(campaignRecipients.status, "sending"),
      ),
    );
}

export async function markRecipientRetry(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  error: string,
  nextAttemptAt: Date,
) {
  await db
    .update(campaignRecipients)
    .set({ status: "queued", lastError: error.slice(0, 300), nextAttemptAt })
    .where(whereRecipient({ organizationId, id }));
}

export async function markRecipientFailed(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  status: "failed" | "skipped",
  error: string,
) {
  await db
    .update(campaignRecipients)
    .set({ status, lastError: error.slice(0, 300) })
    .where(whereRecipient({ organizationId, id }));
}

/** Gives claimed-but-unsent rows back (campaign paused or daily cap reached mid-batch). */
export async function releaseRecipients(
  db: Database,
  organizationId: OrganizationId,
  ids: string[],
) {
  if (ids.length === 0) return;
  await db
    .update(campaignRecipients)
    .set({
      status: "queued",
      attempts: sql`greatest(${campaignRecipients.attempts} - 1, 0)`,
    })
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        inArray(campaignRecipients.id, ids),
        eq(campaignRecipients.status, "sending"),
      ),
    );
}

export async function recipientCounts(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
) {
  const rows = await db
    .select({ status: campaignRecipients.status, n: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        eq(campaignRecipients.campaignId, campaignId),
      ),
    )
    .groupBy(campaignRecipients.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Marks the campaign completed once nothing is left to send. Returns the row if it just completed. */
export async function completeIfDone(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  now: Date,
) {
  const [row] = await db
    .update(campaigns)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, campaignId),
        eq(campaigns.status, "sending"),
        sql`not exists (select 1 from campaign_recipients r where r.campaign_id = ${campaignId}::uuid and r.status in ('queued','sending'))`,
      ),
    )
    .returning();
  return row ?? null;
}

/** sending → paused/failed by the engine, with the reason shown to users. */
export async function haltCampaign(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  status: "paused" | "failed",
  reason: string,
  now: Date,
) {
  const [row] = await db
    .update(campaigns)
    .set({ status, haltReason: reason, updatedAt: now })
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, campaignId),
        eq(campaigns.status, "sending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function getCampaignStatus(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
) {
  const [row] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(
      and(eq(campaigns.organizationId, organizationId), eq(campaigns.id, campaignId)),
    )
    .limit(1);
  return row?.status ?? null;
}

/** Emails this organization has sent since `since` (the daily-cap meter). */
export async function countSentSince(
  db: Database,
  organizationId: OrganizationId,
  since: Date,
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        isNotNull(campaignRecipients.sentAt),
        sql`${campaignRecipients.sentAt} >= ${since}`,
      ),
    );
  return row?.n ?? 0;
}

export async function campaignHealth(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
) {
  const [row] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${campaignRecipients.sentAt} is not null)::int`,
      bounced: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'bounced')::int`,
      complained: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'complained')::int`,
    })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        eq(campaignRecipients.campaignId, campaignId),
      ),
    );
  return row ?? { sent: 0, bounced: 0, complained: 0 };
}

// ---- provider events -------------------------------------------------------------------------------

/** Cross-tenant: SES identifies a message only by its id. */
export async function findRecipientByMessageId(db: Database, messageId: string) {
  const [row] = await db
    .select()
    .from(campaignRecipients)
    .where(eq(campaignRecipients.providerMessageId, messageId))
    .limit(1);
  return row ?? null;
}

/** False when this provider event was already recorded (redelivery). */
export async function recordEmailEvent(
  db: Database,
  input: {
    organizationId: OrganizationId | null;
    providerEventId: string;
    type: string;
    campaignId: string | null;
    recipientId: string | null;
    payload: unknown;
    occurredAt: Date;
  },
) {
  const rows = await db
    .insert(emailEvents)
    .values(input)
    .onConflictDoNothing({ target: emailEvents.providerEventId })
    .returning({ id: emailEvents.id });
  return rows.length > 0;
}

export async function applyRecipientEvent(
  db: Database,
  organizationId: OrganizationId,
  recipientId: string,
  event: "delivered" | "bounced" | "complained",
  at: Date,
) {
  const column =
    event === "delivered"
      ? "deliveredAt"
      : event === "bounced"
        ? "bouncedAt"
        : "complainedAt";
  // Never downgrade: a complaint outranks a bounce outranks delivery.
  const rank = { delivered: 1, bounced: 2, complained: 3 } as const;
  const allowedFrom = (["sent", "delivered", "bounced", "complained"] as const).filter(
    (s) => s === "sent" || rank[s as keyof typeof rank] < rank[event],
  );
  const [row] = await db
    .update(campaignRecipients)
    .set({ status: event, [column]: at })
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        eq(campaignRecipients.id, recipientId),
        inArray(campaignRecipients.status, allowedFrom),
      ),
    )
    .returning();
  return row ?? null;
}

/** Suppress + flip the contact: unsubscribe, hard bounce or complaint. Idempotent. */
export async function suppressForEvent(
  db: Database,
  organizationId: OrganizationId,
  email: string,
  reason: "unsubscribe" | "hard_bounce" | "complaint",
) {
  await addSuppressions(db, organizationId, { emails: [email], reason, userId: null });
}

export async function markRecipientUnsubscribed(
  db: Database,
  organizationId: OrganizationId,
  recipientId: string,
  at: Date,
) {
  await db
    .update(campaignRecipients)
    .set({ unsubscribedAt: at })
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        eq(campaignRecipients.id, recipientId),
        sql`${campaignRecipients.unsubscribedAt} is null`,
      ),
    );
}

export async function getRecipient(
  db: Database,
  organizationId: OrganizationId,
  recipientId: string,
) {
  const [row] = await db
    .select()
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        eq(campaignRecipients.id, recipientId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getOrgSendLimit(db: Database, organizationId: OrganizationId) {
  const r = await db.execute<{ daily_send_limit: number }>(
    sql`select daily_send_limit from organizations where id = ${organizationId}::uuid`,
  );
  return r.rows[0]?.daily_send_limit ?? 0;
}

export type { Campaign };
