import {
  ENTITLEMENT_KEYS,
  PLAN_KEYS,
  type EntitlementKey,
  type Limit,
  type PlanKey,
} from "@mailory/core";
import {
  asOrganizationId,
  clearOverride,
  createOrganizationWithoutOwner,
  entitlementsOverview,
  getOrganizationMetrics,
  listOrganizationsOverview,
  recordAudit,
  setDailySendLimit,
  setOrganizationKind,
  setOverride,
  setSubscription,
  setSuspension,
  type Database,
} from "@mailory/db";
import { inviteFirstOwner, type OrgDeps } from "../org/service";

/** A signed-in user who is a platform admin (resolved from the session; never from client input). */
export type PlatformActor = {
  userId: string;
  isPlatformAdmin: boolean;
  ip?: string | null;
  userAgent?: string | null;
};
export type PlatformDeps = OrgDeps & { db: Database };
type Code = "forbidden" | "not_found" | "invalid" | "duplicate";
export type Failure = { ok: false; code: Code; message?: string };
const fail = (code: Code, message?: string): Failure => ({ ok: false, code, message });
const guard = (a: PlatformActor) => (a.isPlatformAdmin ? null : fail("forbidden"));
const now = (d: PlatformDeps) => (d.now ?? (() => new Date()))();

function audit(
  deps: PlatformDeps,
  a: PlatformActor,
  orgId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: asOrganizationId(orgId),
    userId: a.userId,
    action: `platform.${action}`,
    entityType: "organization",
    entityId: orgId,
    ip: a.ip,
    userAgent: a.userAgent,
    metadata,
  });
}

export async function listOrgsFor(deps: PlatformDeps, a: PlatformActor, q?: string) {
  const g = guard(a);
  if (g) return g;
  return { ok: true as const, orgs: await listOrganizationsOverview(deps.db, { q }) };
}

export async function getOrgFor(deps: PlatformDeps, a: PlatformActor, id: string) {
  const g = guard(a);
  if (g) return g;
  const metrics = await getOrganizationMetrics(deps.db, asOrganizationId(id));
  if (!metrics) return fail("not_found");
  return {
    ok: true as const,
    metrics,
    entitlements: await entitlementsOverview(deps.db, asOrganizationId(id), now(deps)),
  };
}

export async function setPlanFor(
  deps: PlatformDeps,
  a: PlatformActor,
  id: string,
  input: { planKey: PlanKey; note?: string | null },
) {
  const g = guard(a);
  if (g) return g;
  if (!PLAN_KEYS.includes(input.planKey)) return fail("invalid", "Geçersiz plan.");
  const org = await getOrganizationMetrics(deps.db, asOrganizationId(id));
  if (!org) return fail("not_found");
  await setSubscription(deps.db, asOrganizationId(id), {
    planKey: input.planKey,
    source: "manual",
    note: input.note ?? null,
    userId: a.userId,
  });
  await audit(deps, a, id, "plan_set", { plan: input.planKey });
  return { ok: true as const };
}

export async function setLimitFor(
  deps: PlatformDeps,
  a: PlatformActor,
  id: string,
  input: { key: EntitlementKey; limit: Limit | "clear"; reason: string | null },
) {
  const g = guard(a);
  if (g) return g;
  if (!ENTITLEMENT_KEYS.includes(input.key))
    return fail("invalid", "Geçersiz limit anahtarı.");
  if (
    input.limit !== "clear" &&
    input.limit !== null &&
    (!Number.isInteger(input.limit) || input.limit < 0)
  )
    return fail("invalid", "Limit 0 veya pozitif tam sayı olmalı.");
  if (!(await getOrganizationMetrics(deps.db, asOrganizationId(id))))
    return fail("not_found");
  if (input.limit === "clear")
    await clearOverride(deps.db, asOrganizationId(id), input.key);
  else
    await setOverride(deps.db, asOrganizationId(id), {
      key: input.key,
      limit: input.limit,
      reason: input.reason,
      userId: a.userId,
      byOrganizationId: null,
    });
  await audit(deps, a, id, "limit_set", { key: input.key, limit: input.limit });
  return { ok: true as const };
}

export async function setDailyLimitFor(
  deps: PlatformDeps,
  a: PlatformActor,
  id: string,
  limit: number,
) {
  const g = guard(a);
  if (g) return g;
  if (!Number.isInteger(limit) || limit < 0 || limit > 10_000_000)
    return fail("invalid", "Geçersiz günlük sınır.");
  if (!(await getOrganizationMetrics(deps.db, asOrganizationId(id))))
    return fail("not_found");
  await setDailySendLimit(deps.db, asOrganizationId(id), limit);
  await audit(deps, a, id, "daily_limit_set", { limit });
  return { ok: true as const };
}

export async function suspendFor(
  deps: PlatformDeps,
  a: PlatformActor,
  id: string,
  reason: string | null,
) {
  const g = guard(a);
  if (g) return g;
  if (reason !== null && !reason.trim())
    return fail("invalid", "Askıya alma gerekçesi gerekli.");
  if (!(await getOrganizationMetrics(deps.db, asOrganizationId(id))))
    return fail("not_found");
  await setSuspension(
    deps.db,
    asOrganizationId(id),
    reason?.trim().slice(0, 300) ?? null,
    now(deps),
  );
  await audit(deps, a, id, reason === null ? "reinstated" : "suspended", { reason });
  return { ok: true as const };
}

export async function setKindFor(
  deps: PlatformDeps,
  a: PlatformActor,
  id: string,
  input: { type: "standard" | "partner"; parentOrganizationId: string | null },
) {
  const g = guard(a);
  if (g) return g;
  if (input.parentOrganizationId === id)
    return fail("invalid", "Bir kurum kendi üst kurumu olamaz.");
  if (!(await getOrganizationMetrics(deps.db, asOrganizationId(id))))
    return fail("not_found");
  if (input.parentOrganizationId) {
    const parent = await getOrganizationMetrics(
      deps.db,
      asOrganizationId(input.parentOrganizationId),
    );
    if (!parent || parent.type !== "partner")
      return fail("invalid", "Üst kurum bir partner olmalı.");
    if (input.type === "partner")
      return fail("invalid", "Partner kurumların üst kurumu olamaz.");
  }
  await setOrganizationKind(deps.db, asOrganizationId(id), input);
  await audit(deps, a, id, "kind_set", input);
  return { ok: true as const };
}

/** Creates a partner (e.g. BTM) workspace with no members; the invited owner takes it over. */
export async function createPartnerFor(
  deps: PlatformDeps,
  a: PlatformActor,
  input: { name: string; ownerEmail: string },
) {
  const g = guard(a);
  if (g) return g;
  const org = await createOrganizationWithoutOwner(deps.db, {
    name: input.name,
    type: "partner",
  });
  await setSubscription(deps.db, asOrganizationId(org.id), {
    planKey: "enterprise",
    source: "manual",
    note: "Partner kurum",
    userId: a.userId,
  });
  const invited = await inviteFirstOwner(deps, {
    organizationId: asOrganizationId(org.id),
    email: input.ownerEmail.toLowerCase(),
    invitedByUserId: a.userId,
  });
  await audit(deps, a, org.id, "partner_created", { name: input.name });
  return { ok: true as const, id: org.id, invited: invited.ok };
}

/** Operational snapshot for platform admins. Counts only — no tenant content. */
export async function getSystemStatus(
  deps: PlatformDeps,
  a: PlatformActor,
  heartbeat: () => Promise<string | null>,
) {
  const g = guard(a);
  if (g) return g;
  const { sql } = await import("drizzle-orm");
  const n = async (q: ReturnType<typeof sql>) =>
    Number((await deps.db.execute<{ n: number }>(q)).rows[0]?.n ?? 0);
  const [sending, queued, failed24h, outboxFailed, activeAutomations, suspended, orgs] =
    await Promise.all([
      n(
        sql`select count(*)::int as n from campaigns where status = 'sending' and kind = 'campaign'`,
      ),
      n(
        sql`select count(*)::int as n from campaign_recipients where status in ('queued','sending')`,
      ),
      n(
        sql`select count(*)::int as n from campaign_recipients where status = 'failed' and created_at > now() - interval '24 hours'`,
      ),
      n(
        sql`select count(*)::int as n from email_outbox where sent_at is null and last_error is not null`,
      ),
      n(sql`select count(*)::int as n from automations where status = 'active'`),
      n(
        sql`select count(*)::int as n from organizations where suspended_at is not null and deleted_at is null`,
      ),
      n(sql`select count(*)::int as n from organizations where deleted_at is null`),
    ]);
  const beat = await heartbeat().catch(() => null);
  const ageSeconds = beat
    ? Math.max(0, Math.round((now(deps).getTime() - new Date(beat).getTime()) / 1000))
    : null;
  return {
    ok: true as const,
    worker: { alive: ageSeconds !== null && ageSeconds < 60, ageSeconds },
    counts: {
      sending,
      queued,
      failed24h,
      outboxFailed,
      activeAutomations,
      suspended,
      orgs,
    },
  };
}
