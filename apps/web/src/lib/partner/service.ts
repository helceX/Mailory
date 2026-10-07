import {
  ENTITLEMENT_KEYS,
  can,
  type EntitlementKey,
  type Limit,
  type PlanKey,
} from "@mailory/core";
import {
  archiveSharedTemplate,
  asOrganizationId,
  clearOverride,
  createOrganizationWithoutOwner,
  createSharedTemplate,
  entitlementsOverview,
  getChildOrganization,
  getOrganization,
  getPlanLimits,
  getSharedTemplate,
  getTemplate,
  listChildOrganizations,
  listSharedTemplates,
  recordAudit,
  setOverride,
  setSubscription,
  setSuspension,
  type Database,
} from "@mailory/db";
import { emailDocSchema } from "@mailory/validation";
import { inviteFirstOwner, type Actor, type OrgDeps } from "../org/service";
import { createTemplateFor, saveTemplateFor } from "../templates/service";

export type PartnerDeps = OrgDeps & { db: Database };
type Code = "forbidden" | "not_found" | "invalid" | "duplicate" | "cap_exceeded";
export type Failure = { ok: false; code: Code; message?: string };
const fail = (code: Code, message?: string): Failure => ({ ok: false, code, message });
const now = (d: PartnerDeps) => (d.now ?? (() => new Date()))();

/** Plans a partner may sponsor. `enterprise` stays a platform-admin decision. */
export const SPONSORABLE_PLANS: PlanKey[] = [
  "btm_sponsored",
  "free",
  "starter",
  "growth",
  "pro",
];
/** A partner may raise any single limit up to what the `pro` plan grants; beyond that needs a platform admin. */
export const SPONSOR_CAP_PLAN: PlanKey = "pro";

/** Partner admin = an owner/admin of an organization of type `partner`. Everything below starts here. */
async function partnerGuard(deps: PartnerDeps, actor: Actor): Promise<Failure | null> {
  if (!can(actor.role, "org:manage_settings")) return fail("forbidden");
  const org = await getOrganization(deps.db, actor.organizationId);
  return org?.type === "partner" ? null : fail("forbidden");
}

function audit(
  deps: PartnerDeps,
  actor: Actor,
  childId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: asOrganizationId(childId),
    userId: actor.userId,
    action: `partner.${action}`,
    entityType: "organization",
    entityId: childId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { ...metadata, partnerOrganizationId: actor.organizationId },
  });
}

/** Status/usage/onboarding of sponsored workspaces. Aggregates only — never contacts, campaigns, content or reports. */
export async function listChildrenFor(deps: PartnerDeps, actor: Actor) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  return {
    ok: true as const,
    children: await listChildOrganizations(deps.db, actor.organizationId),
  };
}

export async function getChildFor(deps: PartnerDeps, actor: Actor, childId: string) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  const child = await getChildOrganization(deps.db, actor.organizationId, childId);
  if (!child) return fail("not_found");
  return {
    ok: true as const,
    child,
    entitlements: await entitlementsOverview(
      deps.db,
      asOrganizationId(childId),
      now(deps),
    ),
  };
}

/** Opens a workspace for an entrepreneur: no member from the sponsor, the invited person becomes the owner. */
export async function createEntrepreneurFor(
  deps: PartnerDeps,
  actor: Actor,
  input: { name: string; ownerEmail: string; planKey?: PlanKey },
) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  const plan = input.planKey ?? "btm_sponsored";
  if (!SPONSORABLE_PLANS.includes(plan))
    return fail("invalid", "Bu plan sponsorlanamaz.");
  const org = await createOrganizationWithoutOwner(deps.db, {
    name: input.name,
    parentOrganizationId: actor.organizationId,
  });
  const id = asOrganizationId(org.id);
  await setSubscription(deps.db, id, {
    planKey: plan,
    source: "sponsored",
    sponsorOrganizationId: actor.organizationId,
    userId: actor.userId,
  });
  const invited = await inviteFirstOwner(deps, {
    organizationId: id,
    email: input.ownerEmail.toLowerCase(),
    invitedByUserId: actor.userId,
  });
  await audit(deps, actor, org.id, "child_created", { plan });
  return { ok: true as const, id: org.id, invited: invited.ok };
}

export async function setChildPlanFor(
  deps: PartnerDeps,
  actor: Actor,
  childId: string,
  planKey: PlanKey,
) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  if (!SPONSORABLE_PLANS.includes(planKey))
    return fail("invalid", "Bu plan sponsorlanamaz.");
  if (!(await getChildOrganization(deps.db, actor.organizationId, childId)))
    return fail("not_found");
  await setSubscription(deps.db, asOrganizationId(childId), {
    planKey,
    source: "sponsored",
    sponsorOrganizationId: actor.organizationId,
    userId: actor.userId,
  });
  await audit(deps, actor, childId, "plan_set", { plan: planKey });
  return { ok: true as const };
}

export async function setChildLimitFor(
  deps: PartnerDeps,
  actor: Actor,
  childId: string,
  input: { key: EntitlementKey; limit: number | "clear"; reason: string | null },
) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  if (!ENTITLEMENT_KEYS.includes(input.key))
    return fail("invalid", "Geçersiz limit anahtarı.");
  if (!(await getChildOrganization(deps.db, actor.organizationId, childId)))
    return fail("not_found");
  if (input.limit === "clear")
    await clearOverride(deps.db, asOrganizationId(childId), input.key);
  else {
    if (!Number.isInteger(input.limit) || input.limit < 0)
      return fail("invalid", "Limit 0 veya pozitif tam sayı olmalı.");
    const cap: Limit = (await getPlanLimits(deps.db, SPONSOR_CAP_PLAN))[input.key];
    if (cap !== null && input.limit > cap)
      return fail(
        "cap_exceeded",
        `Bir partner bu limiti en fazla ${cap.toLocaleString("tr-TR")} yapabilir; daha fazlası için platform yöneticisine başvurun.`,
      );
    await setOverride(deps.db, asOrganizationId(childId), {
      key: input.key,
      limit: input.limit,
      reason: input.reason,
      userId: actor.userId,
      byOrganizationId: actor.organizationId,
    });
  }
  await audit(deps, actor, childId, "limit_set", {
    key: input.key,
    limit: input.limit,
  });
  return { ok: true as const };
}

export async function suspendChildFor(
  deps: PartnerDeps,
  actor: Actor,
  childId: string,
  reason: string | null,
) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  if (reason !== null && !reason.trim()) return fail("invalid", "Gerekçe gerekli.");
  if (!(await getChildOrganization(deps.db, actor.organizationId, childId)))
    return fail("not_found");
  await setSuspension(
    deps.db,
    asOrganizationId(childId),
    reason?.trim().slice(0, 300) ?? null,
    now(deps),
  );
  await audit(deps, actor, childId, reason === null ? "reinstated" : "suspended", {
    reason,
  });
  return { ok: true as const };
}

/** Ends sponsorship: the workspace falls back to the free plan (its data stays). */
export async function endSponsorshipFor(
  deps: PartnerDeps,
  actor: Actor,
  childId: string,
) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  if (!(await getChildOrganization(deps.db, actor.organizationId, childId)))
    return fail("not_found");
  await setSubscription(deps.db, asOrganizationId(childId), {
    planKey: "free",
    source: "manual",
    note: "Sponsorluk sona erdi",
    userId: actor.userId,
  });
  await audit(deps, actor, childId, "sponsorship_ended");
  return { ok: true as const };
}

// ---- Template Hub -------------------------------------------------------------------------------------------------

export async function listHubFor(deps: PartnerDeps, actor: Actor) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  return {
    ok: true as const,
    templates: await listSharedTemplates(deps.db, actor.organizationId),
  };
}

/** Publishes a snapshot of one of the partner's own templates to its sponsored workspaces. */
export async function publishToHubFor(
  deps: PartnerDeps,
  actor: Actor,
  input: { templateId: string; description?: string | null },
) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  const t = await getTemplate(deps.db, actor.organizationId, input.templateId);
  if (!t) return fail("not_found");
  const doc = emailDocSchema.safeParse(t.version.doc);
  if (!doc.success) return fail("invalid", "Şablon içeriği okunamadı.");
  const row = await createSharedTemplate(deps.db, actor.organizationId, {
    name: t.template.name,
    category: t.template.category,
    description: input.description?.slice(0, 300) ?? null,
    doc: doc.data,
    userId: actor.userId,
  });
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "partner.hub_published",
    entityType: "shared_template",
    entityId: row.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { name: row.name },
  });
  return { ok: true as const, id: row.id };
}

export async function unpublishFromHubFor(deps: PartnerDeps, actor: Actor, id: string) {
  const g = await partnerGuard(deps, actor);
  if (g) return g;
  if (!(await archiveSharedTemplate(deps.db, actor.organizationId, id)))
    return fail("not_found");
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "partner.hub_unpublished",
    entityType: "shared_template",
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: {},
  });
  return { ok: true as const };
}

/** A sponsored workspace sees ONLY its own sponsor's hub. */
async function sponsorOf(deps: PartnerDeps, actor: Actor) {
  const org = await getOrganization(deps.db, actor.organizationId);
  return org?.parentOrganizationId ? asOrganizationId(org.parentOrganizationId) : null;
}

export async function listHubForChild(deps: PartnerDeps, actor: Actor) {
  if (!can(actor.role, "templates:read")) return fail("forbidden");
  const sponsor = await sponsorOf(deps, actor);
  if (!sponsor)
    return {
      ok: true as const,
      templates: [] as Awaited<ReturnType<typeof listSharedTemplates>>,
      sponsorName: null,
    };
  const sponsorOrg = await getOrganization(deps.db, sponsor);
  return {
    ok: true as const,
    templates: await listSharedTemplates(deps.db, sponsor),
    sponsorName: sponsorOrg?.name ?? null,
  };
}

/** Copies a hub template into the child's own templates (an independent copy: later hub changes never touch it). */
export async function useHubTemplateFor(
  deps: PartnerDeps,
  actor: Actor,
  hubId: string,
) {
  if (!can(actor.role, "templates:write")) return fail("forbidden");
  const sponsor = await sponsorOf(deps, actor);
  if (!sponsor) return fail("not_found");
  const shared = await getSharedTemplate(deps.db, sponsor, hubId);
  if (!shared) return fail("not_found");
  const doc = emailDocSchema.safeParse(shared.doc);
  if (!doc.success) return fail("invalid", "Şablon içeriği okunamadı.");
  const tdeps = { db: deps.db, appUrl: deps.appUrl };
  for (let n = 0; n < 5; n++) {
    const name = (n === 0 ? shared.name : `${shared.name} (${n + 1})`).slice(0, 120);
    const created = await createTemplateFor(tdeps, actor, {
      name,
      category: shared.category as never,
    });
    if (created.ok) {
      const saved = await saveTemplateFor(tdeps, actor, created.id, {
        doc: doc.data,
        note: "Şablon Merkezi'nden",
      });
      return saved.ok
        ? { ok: true as const, id: created.id }
        : fail("invalid", saved.message);
    }
    if (created.code !== "duplicate") return fail("invalid", created.message);
  }
  return fail("duplicate", "Bu isimde çok sayıda şablon var.");
}

/** Everything a partner admin needs to see in one place; used by the dashboard and tests of the privacy boundary. */
export type ChildView = Awaited<ReturnType<typeof listChildOrganizations>>[number];
