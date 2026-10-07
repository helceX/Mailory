import { and, eq, sql } from "drizzle-orm";
import {
  DEFAULT_PLAN,
  ENTITLEMENT_KEYS,
  decide,
  monthStart,
  type Check,
  type EntitlementKey,
  type Limit,
  type PlanKey,
  type SubscriptionSource,
} from "@mailory/core/shared";
import { apiUsageSince } from "./api";
import type { Database, OrganizationId } from "../index";
import {
  entitlementOverrides,
  planEntitlements,
  plans,
  subscriptions,
} from "../schema/index";

export async function getSubscription(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

export async function listPlans(db: Database) {
  return db.select().from(plans).orderBy(plans.sortOrder);
}

/** An organization without a subscription row is on the default plan. A canceled/paused subscription falls back to it too. */
export async function getPlanKey(
  db: Database,
  organizationId: OrganizationId,
): Promise<string> {
  const sub = await getSubscription(db, organizationId);
  return sub && (sub.status === "active" || sub.status === "trialing")
    ? sub.planKey
    : DEFAULT_PLAN;
}

/** Effective limit = override ?? plan entitlement ?? 0 (fail closed). NULL means unlimited. */
export async function getEffectiveLimits(
  db: Database,
  organizationId: OrganizationId,
): Promise<Record<EntitlementKey, Limit>> {
  const planKey = await getPlanKey(db, organizationId);
  const [planRows, overrideRows] = await Promise.all([
    db.select().from(planEntitlements).where(eq(planEntitlements.planKey, planKey)),
    db
      .select()
      .from(entitlementOverrides)
      .where(eq(entitlementOverrides.organizationId, organizationId)),
  ]);
  const out = {} as Record<EntitlementKey, Limit>;
  for (const key of ENTITLEMENT_KEYS) {
    const o = overrideRows.find((r) => r.entitlementKey === key);
    const p = planRows.find((r) => r.entitlementKey === key);
    out[key] = o ? o.limitValue : p ? p.limitValue : 0;
  }
  return out;
}

/**
 * Usage is DERIVED from the source tables (never a separate counter), so it cannot drift from reality — the one
 * exception is API requests, which are counted per day in `api_usage` (a row per request would cost more than it earns).
 * Periodic keys use the current UTC calendar month.
 */
export async function getUsage(
  db: Database,
  organizationId: OrganizationId,
  key: EntitlementKey,
  now: Date = new Date(),
): Promise<number> {
  const org = sql`${organizationId}::uuid`;
  const since = monthStart(now);
  const one = async (q: ReturnType<typeof sql>) =>
    Number((await db.execute<{ n: string | number }>(q)).rows[0]?.n ?? 0);
  switch (key) {
    case "contacts":
      return one(
        sql`select count(*) as n from contacts where organization_id = ${org}`,
      );
    case "emails_per_month":
      return one(
        sql`select count(*) as n from campaign_recipients where organization_id = ${org} and sent_at >= ${since}`,
      );
    case "members":
      return one(sql`select (select count(*) from memberships where organization_id = ${org} and status = 'active')
                          + (select count(*) from invitations where organization_id = ${org} and accepted_at is null and revoked_at is null and expires_at > ${now}) as n`);
    case "automations":
      return one(
        sql`select count(*) as n from automations where organization_id = ${org} and status in ('active','paused')`,
      );
    case "ai_credits":
      return one(
        sql`select count(*) as n from ai_requests where organization_id = ${org} and ok and created_at >= ${since}`,
      );
    case "storage_mb":
      return one(
        sql`select ceil(coalesce(sum(size), 0) / 1048576.0) as n from assets where organization_id = ${org}`,
      );
    case "api_requests":
      return apiUsageSince(db, organizationId, since);
  }
}

export async function checkEntitlement(
  db: Database,
  organizationId: OrganizationId,
  key: EntitlementKey,
  delta = 1,
  now: Date = new Date(),
): Promise<Check> {
  const limits = await getEffectiveLimits(db, organizationId);
  const limit = limits[key];
  // Unlimited short-circuits the (possibly expensive) usage count.
  const used = limit === null ? 0 : await getUsage(db, organizationId, key, now);
  return decide(key, limit, used, delta);
}

export async function entitlementsOverview(
  db: Database,
  organizationId: OrganizationId,
  now: Date = new Date(),
) {
  const [planKey, limits, sub, overrides] = await Promise.all([
    getPlanKey(db, organizationId),
    getEffectiveLimits(db, organizationId),
    getSubscription(db, organizationId),
    db
      .select()
      .from(entitlementOverrides)
      .where(eq(entitlementOverrides.organizationId, organizationId)),
  ]);
  const rows = await Promise.all(
    ENTITLEMENT_KEYS.map(async (key) => ({
      key,
      limit: limits[key],
      used: await getUsage(db, organizationId, key, now),
      overridden: overrides.some((o) => o.entitlementKey === key),
    })),
  );
  return { planKey, subscription: sub, rows };
}

export async function setSubscription(
  db: Database,
  organizationId: OrganizationId,
  input: {
    planKey: PlanKey;
    source: SubscriptionSource;
    status?: "active" | "trialing" | "paused" | "canceled";
    sponsorOrganizationId?: string | null;
    note?: string | null;
    userId: string | null;
  },
) {
  const values = {
    organizationId,
    planKey: input.planKey,
    source: input.source,
    status: input.status ?? "active",
    sponsorOrganizationId: input.sponsorOrganizationId ?? null,
    note: input.note ?? null,
    updatedByUserId: input.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });
}

export async function setOverride(
  db: Database,
  organizationId: OrganizationId,
  input: {
    key: EntitlementKey;
    limit: Limit;
    reason: string | null;
    userId: string | null;
    byOrganizationId: string | null;
  },
) {
  const values = {
    organizationId,
    entitlementKey: input.key,
    limitValue: input.limit,
    reason: input.reason,
    setByUserId: input.userId,
    setByOrganizationId: input.byOrganizationId,
  };
  await db
    .insert(entitlementOverrides)
    .values(values)
    .onConflictDoUpdate({
      target: [
        entitlementOverrides.organizationId,
        entitlementOverrides.entitlementKey,
      ],
      set: values,
    });
}

export async function clearOverride(
  db: Database,
  organizationId: OrganizationId,
  key: EntitlementKey,
) {
  await db
    .delete(entitlementOverrides)
    .where(
      and(
        eq(entitlementOverrides.organizationId, organizationId),
        eq(entitlementOverrides.entitlementKey, key),
      ),
    );
}

/** The raw limits a plan grants (NULL = unlimited). Used to cap what a partner may hand out. */
export async function getPlanLimits(
  db: Database,
  planKey: string,
): Promise<Record<EntitlementKey, Limit>> {
  const rows = await db
    .select()
    .from(planEntitlements)
    .where(eq(planEntitlements.planKey, planKey));
  const out = {} as Record<EntitlementKey, Limit>;
  for (const key of ENTITLEMENT_KEYS) {
    const r = rows.find((x) => x.entitlementKey === key);
    out[key] = r ? r.limitValue : 0;
  }
  return out;
}
