import { PLAN_LABELS, type Permission, type PlanKey } from "@mailory/core";
import { entitlementsOverview, getOrganization, type Database } from "@mailory/db";
import { authorize, type Actor } from "../org/service";

const need = (a: Actor, p: Permission) => authorize(a, p);

/** What plan this workspace is on, and usage against each limit. */
export async function getPlanOverview(
  deps: { db: Database; now?: () => Date },
  actor: Actor,
) {
  if (!need(actor, "analytics:read"))
    return { ok: false as const, code: "forbidden" as const };
  const o = await entitlementsOverview(
    deps.db,
    actor.organizationId,
    (deps.now ?? (() => new Date()))(),
  );
  const org = await getOrganization(deps.db, actor.organizationId);
  return {
    ok: true as const,
    planKey: o.planKey,
    planName: PLAN_LABELS[o.planKey as PlanKey] ?? o.planKey,
    source: o.subscription?.source ?? "default",
    status: o.subscription?.status ?? "active",
    suspended: Boolean(org?.suspendedAt),
    rows: o.rows,
  };
}
