import {
  collectMergeKeys,
  DEFAULT_UTM,
  evaluateReadiness,
  hasBlockers,
  slugifyUtm,
  walkBlocks,
  CONTACT_MERGE_FIELDS,
  SYSTEM_MERGE_FIELDS,
  type CampaignAudience,
  type CampaignUtm,
  type EmailDoc,
  type Permission,
  type ReadinessIssue,
} from "@mailory/core";
import {
  countSendable,
  createCampaign,
  deleteCampaignDraft,
  getCampaign,
  getCampaignPolicy,
  getList,
  getSegment,
  getTemplate,
  listCampaigns,
  listContactFields,
  listMembers,
  listSenderDomains,
  listSenderIdentities,
  listTags,
  recordAudit,
  setCampaignPolicy,
  transitionCampaign,
  updateCampaignDraft,
  type Campaign,
  type CampaignSnapshot,
  type ContactFilter,
  type Database,
} from "@mailory/db";
import {
  applyUtm,
  applyUtmToText,
  buildMergeValues,
  renderEmail,
} from "@mailory/email";
import {
  emailDocSchema,
  type CampaignDraftInput,
  type SegmentDefinition,
} from "@mailory/validation";
import { authorize, type Actor } from "../org/service";
import { viewIdentities } from "../senders/service";
import { loadBrandKit } from "../templates/service";
import { logoSrcFor } from "@mailory/core";

export type TestMessage = { to: string; subject: string; html: string; text: string };
export type CampaignDeps = {
  db: Database;
  appUrl: string;
  /** Delivers one rendered test email. Real SES delivery arrives with Phase 8; until then it lands in the outbox. */
  sendTest: (message: TestMessage) => Promise<void>;
  now?: () => Date;
};
type Code =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "not_ready"
  | "approval_required"
  | "self_approval";
export type Failure = {
  ok: false;
  code: Code;
  message?: string;
  issues?: ReadinessIssue[];
};
export type Ok<T = object> = { ok: true } & T;

const denied: Failure = { ok: false, code: "forbidden" };
const fail = (code: Code, message?: string, issues?: ReadinessIssue[]): Failure => ({
  ok: false,
  code,
  message,
  issues,
});
const need = (actor: Actor, permission: Permission) => authorize(actor, permission);
const clock = (deps: CampaignDeps) => (deps.now ?? (() => new Date()))();

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 3_600_000;
const PAST_TOLERANCE_MS = 60_000;

function audit(
  deps: CampaignDeps,
  actor: Actor,
  action: string,
  id: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType: "campaign",
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}

// ---- context -----------------------------------------------------------------------------------

type Context = {
  identity: ReturnType<typeof viewIdentities>[number] | null;
  template: { archived: boolean; version: number; doc: EmailDoc | null } | null;
  audienceFilter: ContactFilter | null;
  audienceExists: boolean;
};

async function resolveAudience(
  deps: CampaignDeps,
  actor: Actor,
  audience: CampaignAudience | null,
): Promise<{ filter: ContactFilter | null; exists: boolean }> {
  if (!audience) return { filter: null, exists: false };
  const org = actor.organizationId;
  switch (audience.kind) {
    case "all":
      return { filter: {}, exists: true };
    case "list": {
      const list = await getList(deps.db, org, audience.id);
      return { filter: { listId: audience.id }, exists: Boolean(list) };
    }
    case "tag": {
      const tags = await listTags(deps.db, org);
      return {
        filter: { tagId: audience.id },
        exists: tags.some((t) => t.id === audience.id),
      };
    }
    case "segment": {
      const segment = await getSegment(deps.db, org, audience.id);
      return {
        filter: segment ? { segment: segment.definition as SegmentDefinition } : null,
        exists: Boolean(segment),
      };
    }
  }
}

async function loadContext(
  deps: CampaignDeps,
  actor: Actor,
  row: Campaign,
): Promise<Context> {
  const org = actor.organizationId;
  const [identities, domains, found, audience] = await Promise.all([
    listSenderIdentities(deps.db, org),
    listSenderDomains(deps.db, org),
    row.templateId ? getTemplate(deps.db, org, row.templateId) : null,
    resolveAudience(deps, actor, row.audience),
  ]);
  const identity =
    viewIdentities(identities, domains).find((i) => i.id === row.senderIdentityId) ??
    null;
  const parsed = found ? emailDocSchema.safeParse(found.version.doc) : null;
  return {
    identity,
    template: found
      ? {
          archived: Boolean(found.template.archivedAt),
          version: found.version.version,
          doc: parsed?.success ? (parsed.data as EmailDoc) : null,
        }
      : null,
    audienceFilter: audience.filter,
    audienceExists: audience.exists,
  };
}

const SAMPLE = Object.fromEntries(CONTACT_MERGE_FIELDS.map((f) => [f.key, f.sample]));

async function renderFor(
  deps: CampaignDeps,
  actor: Actor,
  row: Campaign,
  doc: EmailDoc,
  brand: Awaited<ReturnType<typeof loadBrandKit>>,
  customKeys: string[],
) {
  const withPreheader: EmailDoc = {
    ...doc,
    settings: {
      ...doc.settings,
      preheader: row.preheader || doc.settings.preheader,
    },
  };
  const unsubscribeUrl = `${deps.appUrl}/unsubscribe/preview`;
  const viewUrl = `${deps.appUrl}/view/preview`;
  const result = renderEmail(withPreheader, {
    values: buildMergeValues(
      {
        firstName: SAMPLE.first_name,
        lastName: SAMPLE.last_name,
        email: SAMPLE.email,
        company: SAMPLE.company,
        position: SAMPLE.position,
        city: SAMPLE.city,
        sector: SAMPLE.sector,
        custom: Object.fromEntries(customKeys.map((k) => [k, "Örnek"])),
      },
      {
        unsubscribeUrl,
        viewInBrowserUrl: viewUrl,
        orgName: SYSTEM_MERGE_FIELDS.find((f) => f.key === "org_name")!.sample,
      },
    ),
    appUrl: deps.appUrl,
    brandLogoUrl: logoSrcFor(brand) || undefined,
    subject: row.subject,
  });
  // Our own system links are never tagged.
  const skip = [`${deps.appUrl}/unsubscribe/`, `${deps.appUrl}/view/`];
  return {
    ...result,
    html: applyUtm(result.html, row.utm, skip),
    text: applyUtmToText(result.text, row.utm, skip),
  };
}

function hasUnsubscribe(doc: EmailDoc | null): boolean {
  if (!doc) return false;
  if (collectMergeKeys(doc).includes("unsubscribe_url")) return true;
  let found = false;
  walkBlocks(doc, (b) => {
    if (b.type === "footer" && b.showUnsubscribe) found = true;
  });
  return found;
}

async function readiness(deps: CampaignDeps, actor: Actor, row: Campaign) {
  const ctx = await loadContext(deps, actor, row);
  const customKeys = (await listContactFields(deps.db, actor.organizationId)).map(
    (f) => f.key,
  );
  const audienceCount =
    ctx.audienceFilter && ctx.audienceExists
      ? await countSendable(deps.db, actor.organizationId, ctx.audienceFilter)
      : 0;
  let unknown: string[] = [];
  if (ctx.template?.doc) {
    const brand = await loadBrandKit(deps, actor);
    unknown = (await renderFor(deps, actor, row, ctx.template.doc, brand, customKeys))
      .unknownKeys;
  }
  const issues = evaluateReadiness({
    subject: row.subject,
    senderIdentity: ctx.identity ? { usable: ctx.identity.usable } : null,
    hasTemplate: Boolean(ctx.template),
    templateArchived: ctx.template?.archived ?? false,
    audience: row.audience,
    audienceExists: ctx.audienceExists,
    audienceCount,
    hasUnsubscribe: hasUnsubscribe(ctx.template?.doc ?? null),
    unknownMergeKeys: unknown,
    blockCount: ctx.template?.doc?.blocks.length ?? 0,
  });
  if (ctx.template && !ctx.template.doc)
    issues.push({
      code: "empty_content",
      severity: "blocker",
      message: "Şablon içeriği okunamadı.",
    });
  return { ctx, issues, audienceCount, customKeys };
}

// ---- queries -----------------------------------------------------------------------------------

export async function listCampaignsFor(
  deps: CampaignDeps,
  actor: Actor,
  options: { status?: string } = {},
) {
  if (!need(actor, "campaigns:read")) return denied;
  return {
    ok: true as const,
    campaigns: await listCampaigns(deps.db, actor.organizationId, options),
  };
}

export async function getCampaignFor(deps: CampaignDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:read")) return denied;
  const row = await getCampaign(deps.db, actor.organizationId, id);
  if (!row) return fail("not_found");
  const [policy, r] = await Promise.all([
    getCampaignPolicy(deps.db, actor.organizationId),
    readiness(deps, actor, row),
  ]);
  return {
    ok: true as const,
    campaign: row,
    issues: r.issues,
    audienceCount: r.audienceCount,
    requireApproval: policy.requireApproval,
    sender: r.ctx.identity
      ? {
          fromName: r.ctx.identity.fromName,
          fromEmail: r.ctx.identity.fromEmail,
          usable: r.ctx.identity.usable,
        }
      : null,
  };
}

// ---- drafts ------------------------------------------------------------------------------------

export async function createCampaignFor(
  deps: CampaignDeps,
  actor: Actor,
  input: { name: string },
) {
  if (!need(actor, "campaigns:write")) return denied;
  const identities = await listSenderIdentities(deps.db, actor.organizationId);
  const row = await createCampaign(deps.db, actor.organizationId, {
    name: input.name,
    utm: { ...DEFAULT_UTM, campaign: slugifyUtm(input.name) },
    senderIdentityId: identities.find((i) => i.isDefault)?.id ?? null,
    createdByUserId: actor.userId,
  });
  await audit(deps, actor, "campaign.created", row.id, { name: row.name });
  return { ok: true as const, id: row.id };
}

export async function updateCampaignFor(
  deps: CampaignDeps,
  actor: Actor,
  id: string,
  input: CampaignDraftInput,
) {
  if (!need(actor, "campaigns:write")) return denied;
  const org = actor.organizationId;
  const existing = await getCampaign(deps.db, org, id);
  if (!existing) return fail("not_found");
  if (existing.status !== "draft")
    return fail("conflict", "Yalnızca taslak kampanyalar düzenlenebilir.");

  // Foreign-tenant ids are indistinguishable from missing ones.
  if (input.senderIdentityId) {
    const identities = await listSenderIdentities(deps.db, org);
    if (!identities.some((i) => i.id === input.senderIdentityId))
      return fail("invalid", "Gönderici bulunamadı.");
  }
  if (input.templateId) {
    const t = await getTemplate(deps.db, org, input.templateId);
    if (!t) return fail("invalid", "Şablon bulunamadı.");
    if (t.template.archivedAt) return fail("invalid", "Şablon arşivlenmiş.");
  }
  if (input.audience) {
    const a = await resolveAudience(deps, actor, input.audience);
    if (!a.exists) return fail("invalid", "Seçilen kitle bulunamadı.");
  }

  const { replyTo, utm, ...rest } = input;
  const row = await updateCampaignDraft(deps.db, org, id, {
    ...rest,
    ...(replyTo !== undefined ? { replyTo } : {}),
    ...(utm
      ? {
          utm: {
            enabled: utm.enabled,
            source: utm.source,
            medium: utm.medium,
            campaign: utm.campaign,
            ...(utm.content ? { content: utm.content } : {}),
            ...(utm.term ? { term: utm.term } : {}),
          } satisfies CampaignUtm,
        }
      : {}),
  });
  // Lost a race with a status change since the read above.
  if (!row) return fail("conflict", "Kampanya artık düzenlenemez.");
  await audit(deps, actor, "campaign.updated", id, { fields: Object.keys(input) });
  return { ok: true as const, campaign: row };
}

export async function deleteCampaignFor(deps: CampaignDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:write")) return denied;
  const existing = await getCampaign(deps.db, actor.organizationId, id);
  if (!existing) return fail("not_found");
  if (!(await deleteCampaignDraft(deps.db, actor.organizationId, id)))
    return fail("conflict", "Yalnızca taslak kampanyalar silinebilir.");
  await audit(deps, actor, "campaign.deleted", id, { name: existing.name });
  return { ok: true as const };
}

export async function duplicateCampaignFor(
  deps: CampaignDeps,
  actor: Actor,
  id: string,
) {
  if (!need(actor, "campaigns:write")) return denied;
  const src = await getCampaign(deps.db, actor.organizationId, id);
  if (!src) return fail("not_found");
  const copy = await createCampaign(deps.db, actor.organizationId, {
    name: `${src.name} (kopya)`.slice(0, 120),
    subject: src.subject,
    preheader: src.preheader,
    senderIdentityId: src.senderIdentityId,
    replyTo: src.replyTo,
    templateId: src.templateId,
    audience: src.audience,
    utm: src.utm,
    trackOpens: src.trackOpens,
    trackClicks: src.trackClicks,
    createdByUserId: actor.userId,
  });
  await audit(deps, actor, "campaign.duplicated", copy.id, { from: id });
  return { ok: true as const, id: copy.id };
}

// ---- preview + test send -----------------------------------------------------------------------

export async function previewCampaignFor(deps: CampaignDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:read")) return denied;
  const row = await getCampaign(deps.db, actor.organizationId, id);
  if (!row) return fail("not_found");
  const ctx = await loadContext(deps, actor, row);
  if (!ctx.template?.doc) return fail("invalid", "Önce bir şablon seçin.");
  const [brand, fields] = await Promise.all([
    loadBrandKit(deps, actor),
    listContactFields(deps.db, actor.organizationId),
  ]);
  const rendered = await renderFor(
    deps,
    actor,
    row,
    ctx.template.doc,
    brand,
    fields.map((f) => f.key),
  );
  return {
    ok: true as const,
    subject: row.subject,
    html: rendered.html,
    text: rendered.text,
  };
}

export async function listTestRecipientsFor(deps: CampaignDeps, actor: Actor) {
  if (!need(actor, "campaigns:write")) return denied;
  const members = await listMembers(deps.db, actor.organizationId);
  return {
    ok: true as const,
    recipients: members.map((m) => ({
      email: m.email,
      name: `${m.firstName} ${m.lastName}`.trim(),
      self: m.userId === actor.userId,
    })),
  };
}

/** Test emails go only to members of this workspace, so the feature cannot be used to mail strangers. */
export async function sendTestFor(
  deps: CampaignDeps,
  actor: Actor,
  id: string,
  recipients: string[],
) {
  if (!need(actor, "campaigns:write")) return denied;
  const row = await getCampaign(deps.db, actor.organizationId, id);
  if (!row) return fail("not_found");
  const members = await listMembers(deps.db, actor.organizationId);
  const allowed = new Set(members.map((m) => m.email.toLowerCase()));
  const targets = [...new Set(recipients.map((r) => r.toLowerCase()))];
  if (targets.some((t) => !allowed.has(t)))
    return fail(
      "invalid",
      "Test e-postası yalnızca çalışma alanı üyelerine gönderilebilir.",
    );
  const preview = await previewCampaignFor(deps, actor, id);
  if (!preview.ok) return preview;
  for (const to of targets)
    await deps.sendTest({
      to,
      subject: `[TEST] ${row.subject || row.name}`,
      html: preview.html,
      text: preview.text,
    });
  await audit(deps, actor, "campaign.test_sent", id, { count: targets.length });
  return { ok: true as const, sent: targets.length };
}

// ---- scheduling + approval ---------------------------------------------------------------------

function resolveSendAt(
  deps: CampaignDeps,
  sendAt: string | null | undefined,
): { ok: true; at: Date } | Failure {
  const now = clock(deps);
  if (!sendAt) return { ok: true, at: now };
  const at = new Date(sendAt);
  if (Number.isNaN(at.getTime())) return fail("invalid", "Geçersiz tarih.");
  if (at.getTime() < now.getTime() - PAST_TOLERANCE_MS)
    return fail("invalid", "Gönderim zamanı geçmişte olamaz.");
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS)
    return fail("invalid", "Gönderim en fazla 1 yıl sonrasına zamanlanabilir.");
  return { ok: true, at: at.getTime() < now.getTime() ? now : at };
}

async function ensureReady(deps: CampaignDeps, actor: Actor, row: Campaign) {
  const r = await readiness(deps, actor, row);
  if (hasBlockers(r.issues)) {
    const first = r.issues.find((i) => i.severity === "blocker")!;
    return { ok: false as const, failure: fail("not_ready", first.message, r.issues) };
  }
  return { ok: true as const, ...r };
}

async function takeSnapshot(
  deps: CampaignDeps,
  actor: Actor,
  row: Campaign,
  r: Awaited<ReturnType<typeof readiness>>,
): Promise<{ snapshot: CampaignSnapshot; templateVersionId: string } | null> {
  const found = row.templateId
    ? await getTemplate(deps.db, actor.organizationId, row.templateId)
    : null;
  if (!found || !r.ctx.template?.doc || !r.ctx.identity) return null;
  return {
    templateVersionId: found.version.id,
    snapshot: {
      doc: r.ctx.template.doc,
      version: found.version.version,
      brand: await loadBrandKit(deps, actor),
      sender: {
        fromName: r.ctx.identity.fromName,
        fromEmail: r.ctx.identity.fromEmail,
        replyTo: row.replyTo ?? r.ctx.identity.replyTo,
      },
      audienceCount: r.audienceCount,
      takenAt: clock(deps).toISOString(),
    },
  };
}

/** Without an approval policy: draft → scheduled directly. */
export async function scheduleCampaignFor(
  deps: CampaignDeps,
  actor: Actor,
  id: string,
  sendAt?: string | null,
) {
  if (!need(actor, "campaigns:send")) return denied;
  const org = actor.organizationId;
  const row = await getCampaign(deps.db, org, id);
  if (!row) return fail("not_found");
  if (row.status !== "draft")
    return fail("conflict", "Kampanya zaten gönderime alınmış.");
  if ((await getCampaignPolicy(deps.db, org)).requireApproval)
    return fail(
      "approval_required",
      "Bu çalışma alanında kampanyalar onaya gönderilmelidir.",
    );
  const at = resolveSendAt(deps, sendAt);
  if (!at.ok) return at;
  const ready = await ensureReady(deps, actor, row);
  if (!ready.ok) return ready.failure;
  const snap = await takeSnapshot(deps, actor, row, ready);
  if (!snap) return fail("not_ready", "Kampanya içeriği hazırlanamadı.");
  const updated = await transitionCampaign(deps.db, org, id, ["draft"], {
    status: "scheduled",
    scheduledAt: at.at,
    ...snap,
    approvedByUserId: null,
    approvedAt: null,
    rejectionReason: null,
  });
  if (!updated) return fail("conflict", "Kampanya durumu değişti.");
  await audit(deps, actor, "campaign.scheduled", id, {
    at: at.at.toISOString(),
    audienceCount: snap.snapshot.audienceCount,
  });
  return { ok: true as const, campaign: updated };
}

export async function submitCampaignFor(
  deps: CampaignDeps,
  actor: Actor,
  id: string,
  sendAt?: string | null,
) {
  if (!need(actor, "campaigns:send")) return denied;
  const org = actor.organizationId;
  const row = await getCampaign(deps.db, org, id);
  if (!row) return fail("not_found");
  if (row.status !== "draft")
    return fail("conflict", "Yalnızca taslaklar onaya gönderilebilir.");
  const at = resolveSendAt(deps, sendAt);
  if (!at.ok) return at;
  const ready = await ensureReady(deps, actor, row);
  if (!ready.ok) return ready.failure;
  const updated = await transitionCampaign(deps.db, org, id, ["draft"], {
    status: "pending_approval",
    scheduledAt: at.at,
    submittedByUserId: actor.userId,
    submittedAt: clock(deps),
    rejectionReason: null,
  });
  if (!updated) return fail("conflict", "Kampanya durumu değişti.");
  await audit(deps, actor, "campaign.submitted", id, { at: at.at.toISOString() });
  return { ok: true as const, campaign: updated };
}

/** Four-eyes: the approver must be a different person than the submitter. Content is re-validated and frozen now. */
export async function approveCampaignFor(deps: CampaignDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:approve")) return denied;
  const org = actor.organizationId;
  const row = await getCampaign(deps.db, org, id);
  if (!row) return fail("not_found");
  if (row.status !== "pending_approval")
    return fail("conflict", "Kampanya onay beklemiyor.");
  if (row.submittedByUserId === actor.userId)
    return fail("self_approval", "Kendi gönderdiğiniz kampanyayı onaylayamazsınız.");
  const ready = await ensureReady(deps, actor, row);
  if (!ready.ok) return ready.failure;
  const snap = await takeSnapshot(deps, actor, row, ready);
  if (!snap) return fail("not_ready", "Kampanya içeriği hazırlanamadı.");
  const now = clock(deps);
  const updated = await transitionCampaign(deps.db, org, id, ["pending_approval"], {
    status: "scheduled",
    // A send time that passed while waiting for approval means "as soon as approved".
    scheduledAt: row.scheduledAt && row.scheduledAt > now ? row.scheduledAt : now,
    ...snap,
    approvedByUserId: actor.userId,
    approvedAt: now,
  });
  if (!updated) return fail("conflict", "Kampanya durumu değişti.");
  await audit(deps, actor, "campaign.approved", id, {
    submittedBy: row.submittedByUserId,
  });
  return { ok: true as const, campaign: updated };
}

export async function rejectCampaignFor(
  deps: CampaignDeps,
  actor: Actor,
  id: string,
  reason: string,
) {
  if (!need(actor, "campaigns:approve")) return denied;
  const row = await getCampaign(deps.db, actor.organizationId, id);
  if (!row) return fail("not_found");
  const updated = await transitionCampaign(
    deps.db,
    actor.organizationId,
    id,
    ["pending_approval"],
    { status: "draft", rejectionReason: reason, scheduledAt: null },
  );
  if (!updated) return fail("conflict", "Kampanya onay beklemiyor.");
  await audit(deps, actor, "campaign.rejected", id, { reason });
  return { ok: true as const, campaign: updated };
}

/** Withdraws a submitted or scheduled campaign back to an editable draft (nothing has been sent yet). */
export async function returnToDraftFor(deps: CampaignDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:send")) return denied;
  const row = await getCampaign(deps.db, actor.organizationId, id);
  if (!row) return fail("not_found");
  const updated = await transitionCampaign(
    deps.db,
    actor.organizationId,
    id,
    ["pending_approval", "scheduled"],
    {
      status: "draft",
      scheduledAt: null,
      snapshot: null,
      templateVersionId: null,
      submittedByUserId: null,
      submittedAt: null,
      approvedByUserId: null,
      approvedAt: null,
    },
  );
  if (!updated) return fail("conflict", "Kampanya artık taslağa döndürülemez.");
  await audit(deps, actor, "campaign.unscheduled", id, { from: row.status });
  return { ok: true as const, campaign: updated };
}

export async function cancelCampaignFor(deps: CampaignDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:send")) return denied;
  const row = await getCampaign(deps.db, actor.organizationId, id);
  if (!row) return fail("not_found");
  const updated = await transitionCampaign(
    deps.db,
    actor.organizationId,
    id,
    ["pending_approval", "scheduled", "sending", "paused"],
    { status: "cancelled" },
  );
  if (!updated) return fail("conflict", "Kampanya artık iptal edilemez.");
  await audit(deps, actor, "campaign.cancelled", id, { from: row.status });
  return { ok: true as const, campaign: updated };
}

// ---- policy ------------------------------------------------------------------------------------

export async function getPolicyFor(deps: CampaignDeps, actor: Actor) {
  if (!need(actor, "campaigns:read")) return denied;
  return {
    ok: true as const,
    ...(await getCampaignPolicy(deps.db, actor.organizationId)),
  };
}

export async function setPolicyFor(
  deps: CampaignDeps,
  actor: Actor,
  requireApproval: boolean,
) {
  if (!need(actor, "org:manage_settings")) return denied;
  await setCampaignPolicy(deps.db, actor.organizationId, requireApproval);
  await audit(deps, actor, "campaign.policy_changed", null, { requireApproval });
  return { ok: true as const, requireApproval };
}
