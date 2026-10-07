import {
  docHasUnsubscribe,
  emailSteps,
  flatten,
  reviewContent,
  validateStructure,
  type AutomationTrigger,
  type CampaignAudience,
  type DefinitionIssue,
  type EmailDoc,
  type EmailStep,
  type Finding,
  type Permission,
  type Step,
} from "@mailory/core";
import {
  activateAutomation,
  campaignStats,
  createAutomation,
  deleteAutomationDraft,
  enrollContacts,
  enrollmentCounts,
  exitAllEnrollments,
  exitReasons,
  getAutomation,
  getCampaignPolicy,
  getList,
  getTemplate,
  listAutomations,
  listSenderDomains,
  listSenderIdentities,
  listStepCampaigns,
  listTags,
  recordAudit,
  resolveAudienceFilter,
  setAutomationStatus,
  updateAutomationDraft,
  type Automation,
  type CampaignSnapshot,
  type Database,
} from "@mailory/db";
import { emailDocSchema } from "@mailory/validation";
import { enforce, ensureNotSuspended } from "../billing/enforce";
import { authorize, type Actor } from "../org/service";
import { viewIdentities } from "../senders/service";
import { loadBrandKit } from "../templates/service";

export type AutomationDeps = { db: Database; appUrl: string; now?: () => Date };
type Code =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "not_ready"
  | "approval_required";
export type Failure = {
  ok: false;
  code: Code;
  message?: string;
  issues?: DefinitionIssue[];
};
const denied: Failure = { ok: false, code: "forbidden" };
const fail = (code: Code, message?: string, issues?: DefinitionIssue[]): Failure => ({
  ok: false,
  code,
  message,
  issues,
});
const need = (a: Actor, p: Permission) => authorize(a, p);
const clock = (d: AutomationDeps) => (d.now ?? (() => new Date()))();

function audit(
  deps: AutomationDeps,
  actor: Actor,
  action: string,
  id: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType: "automation",
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}

/** Everything a definition points at must exist in THIS organization (foreign ids look exactly like missing ones). */
async function checkReferences(
  deps: AutomationDeps,
  actor: Actor,
  trigger: AutomationTrigger,
  steps: Step[],
) {
  const org = actor.organizationId;
  const issues: DefinitionIssue[] = [];
  const [tags, identities] = await Promise.all([
    listTags(deps.db, org),
    listSenderIdentities(deps.db, org),
  ]);
  const tagIds = new Set(tags.map((t) => t.id));
  const identityIds = new Set(identities.map((i) => i.id));
  if (trigger.type === "list_joined" && !(await getList(deps.db, org, trigger.listId)))
    issues.push({ stepId: null, message: "Tetikleyicideki liste bulunamadı." });
  if (trigger.type === "tag_added" && !tagIds.has(trigger.tagId))
    issues.push({ stepId: null, message: "Tetikleyicideki etiket bulunamadı." });
  const all = [...flatten(steps).nodes.values()].map((n) => n.step);
  for (const s of all) {
    if (s.type === "email") {
      const t = await getTemplate(deps.db, org, s.templateId);
      if (!t) issues.push({ stepId: s.id, message: "Şablon bulunamadı." });
      else if (t.template.archivedAt)
        issues.push({ stepId: s.id, message: "Şablon arşivlenmiş." });
      if (!identityIds.has(s.senderIdentityId))
        issues.push({ stepId: s.id, message: "Gönderici bulunamadı." });
    } else if (s.type === "condition") {
      if (s.check.kind === "has_tag" && !tagIds.has(s.check.tagId))
        issues.push({ stepId: s.id, message: "Koşuldaki etiket bulunamadı." });
      if (s.check.kind === "in_list" && !(await getList(deps.db, org, s.check.listId)))
        issues.push({ stepId: s.id, message: "Koşuldaki liste bulunamadı." });
    }
  }
  return issues;
}

export async function listAutomationsFor(deps: AutomationDeps, actor: Actor) {
  if (!need(actor, "campaigns:read")) return denied;
  return {
    ok: true as const,
    automations: await listAutomations(deps.db, actor.organizationId),
  };
}

export async function createAutomationFor(
  deps: AutomationDeps,
  actor: Actor,
  input: { name: string; trigger: AutomationTrigger },
) {
  if (!need(actor, "campaigns:write")) return denied;
  const issues = await checkReferences(deps, actor, input.trigger, []);
  if (issues.length) return fail("invalid", issues[0]!.message, issues);
  const row = await createAutomation(deps.db, actor.organizationId, {
    ...input,
    userId: actor.userId,
  });
  await audit(deps, actor, "automation.created", row.id, { name: row.name });
  return { ok: true as const, id: row.id };
}

type Readiness = {
  issues: DefinitionIssue[];
  warnings: { stepId: string; findings: Finding[] }[];
};

async function readiness(
  deps: AutomationDeps,
  actor: Actor,
  a: Pick<Automation, "trigger" | "steps">,
): Promise<Readiness> {
  const org = actor.organizationId;
  const steps = a.steps as Step[];
  const issues = [
    ...validateStructure(steps),
    ...(await checkReferences(deps, actor, a.trigger as AutomationTrigger, steps)),
  ];
  const warnings: Readiness["warnings"] = [];
  const [identities, domains] = await Promise.all([
    listSenderIdentities(deps.db, org),
    listSenderDomains(deps.db, org),
  ]);
  const views = viewIdentities(identities, domains);
  for (const s of emailSteps(steps)) {
    const v = views.find((i) => i.id === s.senderIdentityId);
    if (v && !v.usable)
      issues.push({ stepId: s.id, message: "Göndericinin alan adı doğrulanmamış." });
    const t = await getTemplate(deps.db, org, s.templateId);
    const parsed = t ? emailDocSchema.safeParse(t.version.doc) : null;
    const doc = parsed?.success ? (parsed.data as EmailDoc) : null;
    if (t && !doc) issues.push({ stepId: s.id, message: "Şablon içeriği okunamadı." });
    if (doc) {
      if (!docHasUnsubscribe(doc))
        issues.push({
          stepId: s.id,
          message: "Şablonda abonelikten çıkma bağlantısı yok.",
        });
      if (doc.blocks.length === 0)
        issues.push({ stepId: s.id, message: "Şablon boş." });
      const findings = reviewContent({
        subject: s.subject,
        preheader: s.preheader ?? "",
        doc,
        hasUnsubscribe: true,
      });
      if (findings.length) warnings.push({ stepId: s.id, findings });
    }
  }
  return { issues, warnings };
}

export async function getAutomationFor(deps: AutomationDeps, actor: Actor, id: string) {
  if (!need(actor, "campaigns:read")) return denied;
  const org = actor.organizationId;
  const a = await getAutomation(deps.db, org, id);
  if (!a) return fail("not_found");
  const [counts, reasons, stepCampaigns, policy] = await Promise.all([
    enrollmentCounts(deps.db, org, id),
    exitReasons(deps.db, org, id),
    listStepCampaigns(deps.db, org, id),
    getCampaignPolicy(deps.db, org),
  ]);
  const stepStats = await Promise.all(
    stepCampaigns.map(async (c) => ({
      stepId: c.automationStepId!,
      stats: await campaignStats(deps.db, org, c.id),
    })),
  );
  return {
    ok: true as const,
    automation: a,
    counts,
    exitReasons: reasons,
    stepStats,
    requireApproval: policy.requireApproval,
    readiness: a.status === "draft" ? await readiness(deps, actor, a) : null,
  };
}

export async function updateAutomationFor(
  deps: AutomationDeps,
  actor: Actor,
  id: string,
  input: { name?: string; trigger?: AutomationTrigger; steps?: Step[] },
) {
  if (!need(actor, "campaigns:write")) return denied;
  const org = actor.organizationId;
  const a = await getAutomation(deps.db, org, id);
  if (!a) return fail("not_found");
  if (a.status !== "draft")
    return fail(
      "conflict",
      "Başlamış bir otomasyonun yapısı değiştirilemez; kopyasını oluşturun.",
    );
  const trigger = input.trigger ?? (a.trigger as AutomationTrigger);
  const steps = input.steps ?? (a.steps as Step[]);
  // Drafts may be incomplete while being built, but never structurally unsafe (duplicate ids, absurd nesting…).
  const refs = await checkReferences(deps, actor, trigger, steps);
  if (refs.length) return fail("invalid", refs[0]!.message, refs);
  const hard = validateStructure(steps).filter((i) =>
    /tekrar|iç içe|En fazla|en az 1 dakika/.test(i.message),
  );
  if (hard.length) return fail("invalid", hard[0]!.message, hard);
  const row = await updateAutomationDraft(deps.db, org, id, input);
  if (!row) return fail("conflict", "Otomasyon artık düzenlenemez.");
  await audit(deps, actor, "automation.updated", id, { fields: Object.keys(input) });
  return { ok: true as const };
}

export async function deleteAutomationFor(
  deps: AutomationDeps,
  actor: Actor,
  id: string,
) {
  if (!need(actor, "campaigns:write")) return denied;
  const a = await getAutomation(deps.db, actor.organizationId, id);
  if (!a) return fail("not_found");
  if (!(await deleteAutomationDraft(deps.db, actor.organizationId, id)))
    return fail("conflict", "Yalnızca taslaklar silinebilir.");
  await audit(deps, actor, "automation.deleted", id, { name: a.name });
  return { ok: true as const };
}

export async function duplicateAutomationFor(
  deps: AutomationDeps,
  actor: Actor,
  id: string,
) {
  if (!need(actor, "campaigns:write")) return denied;
  const a = await getAutomation(deps.db, actor.organizationId, id);
  if (!a) return fail("not_found");
  const copy = await createAutomation(deps.db, actor.organizationId, {
    name: `${a.name} (kopya)`.slice(0, 120),
    trigger: a.trigger as AutomationTrigger,
    userId: actor.userId,
  });
  await updateAutomationDraft(deps.db, actor.organizationId, copy.id, {
    steps: a.steps as Step[],
  });
  await audit(deps, actor, "automation.duplicated", copy.id, { from: id });
  return { ok: true as const, id: copy.id };
}

/**
 * Going live is the consequential moment: with an approval policy only an approver may do it; content is validated and
 * FROZEN (each email step gets a snapshot of its template), so later template edits never change a running flow.
 */
export async function activateAutomationFor(
  deps: AutomationDeps,
  actor: Actor,
  id: string,
) {
  if (!need(actor, "campaigns:send")) return denied;
  const org = actor.organizationId;
  const a = await getAutomation(deps.db, org, id);
  if (!a) return fail("not_found");
  if (a.status !== "draft") return fail("conflict", "Otomasyon zaten başlamış.");
  if (
    (await getCampaignPolicy(deps.db, org)).requireApproval &&
    !need(actor, "campaigns:approve")
  )
    return fail(
      "approval_required",
      "Bu çalışma alanında otomasyonları yalnızca onay yetkisi olan yöneticiler başlatabilir.",
    );
  const suspended = await ensureNotSuspended(deps.db, org);
  if (suspended) return suspended;
  const limited = await enforce(deps.db, org, "automations", 1, clock(deps));
  if (limited) return limited;
  const r = await readiness(deps, actor, a);
  if (r.issues.length) return fail("not_ready", r.issues[0]!.message, r.issues);

  const brand = await loadBrandKit({ db: deps.db, appUrl: deps.appUrl }, actor);
  const [identities] = await Promise.all([listSenderIdentities(deps.db, org)]);
  const steps = a.steps as Step[];
  const stepCampaigns = [];
  for (const s of emailSteps(steps) as EmailStep[]) {
    const t = (await getTemplate(deps.db, org, s.templateId))!;
    const ident = identities.find((i) => i.id === s.senderIdentityId)!;
    const snapshot: CampaignSnapshot = {
      doc: emailDocSchema.parse(t.version.doc),
      version: t.version.version,
      brand,
      sender: {
        fromName: ident.fromName,
        fromEmail: ident.fromEmail,
        replyTo: ident.replyTo,
      },
      audienceCount: 0,
      takenAt: clock(deps).toISOString(),
    };
    stepCampaigns.push({
      stepId: s.id,
      name: `${a.name} · ${s.subject}`.slice(0, 120),
      subject: s.subject,
      preheader: s.preheader ?? "",
      senderIdentityId: s.senderIdentityId,
      templateId: s.templateId,
      templateVersionId: t.version.id,
      snapshot,
    });
  }
  const row = await activateAutomation(deps.db, org, id, stepCampaigns, clock(deps));
  if (!row) return fail("conflict", "Otomasyon durumu değişti.");
  await audit(deps, actor, "automation.activated", id, {
    emails: stepCampaigns.length,
  });
  return { ok: true as const };
}

async function transition(
  deps: AutomationDeps,
  actor: Actor,
  id: string,
  from: string[],
  to: "active" | "paused" | "archived",
  action: string,
) {
  if (!need(actor, "campaigns:send")) return denied;
  const a = await getAutomation(deps.db, actor.organizationId, id);
  if (!a) return fail("not_found");
  const row = await setAutomationStatus(deps.db, actor.organizationId, id, from, to);
  if (!row) return fail("conflict", "Otomasyonun durumu bu işlem için uygun değil.");
  if (to === "archived")
    await exitAllEnrollments(
      deps.db,
      actor.organizationId,
      id,
      "automation_archived",
      clock(deps),
    );
  await audit(deps, actor, action, id);
  return { ok: true as const };
}
export const pauseAutomationFor = (d: AutomationDeps, a: Actor, id: string) =>
  transition(d, a, id, ["active"], "paused", "automation.paused");
export const resumeAutomationFor = (d: AutomationDeps, a: Actor, id: string) =>
  transition(d, a, id, ["paused"], "active", "automation.resumed");
export const archiveAutomationFor = (d: AutomationDeps, a: Actor, id: string) =>
  transition(d, a, id, ["active", "paused"], "archived", "automation.archived");

/** Manually enrol the eligible contacts of an audience into a running 'manual' automation. */
export async function enrollAudienceFor(
  deps: AutomationDeps,
  actor: Actor,
  id: string,
  audience: CampaignAudience,
) {
  if (!need(actor, "campaigns:send")) return denied;
  const org = actor.organizationId;
  const a = await getAutomation(deps.db, org, id);
  if (!a) return fail("not_found");
  if (a.status !== "active")
    return fail("conflict", "Kişileri yalnızca etkin bir otomasyona ekleyebilirsiniz.");
  if ((a.trigger as AutomationTrigger).type !== "manual")
    return fail(
      "conflict",
      "Bu otomasyon otomatik tetiklenir; elle kayıt yalnızca 'elle' tetikleyicide.",
    );
  const first = flatten(a.steps as Step[]).first;
  if (!first) return fail("invalid", "Otomasyonda adım yok.");
  const resolved = await resolveAudienceFilter(deps.db, org, audience);
  if (!resolved.filter || !resolved.exists)
    return fail("invalid", "Seçilen kitle bulunamadı.");
  const enrolled = await enrollContacts(
    deps.db,
    org,
    id,
    resolved.filter,
    first,
    clock(deps),
  );
  await audit(deps, actor, "automation.enrolled", id, { enrolled, audience });
  return { ok: true as const, enrolled };
}
