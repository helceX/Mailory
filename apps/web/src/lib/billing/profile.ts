import type { Permission } from "@mailory/core";
import {
  getBillingProfile,
  recordAudit,
  upsertBillingProfile,
  type Database,
} from "@mailory/db";
import type { BillingProfileValues } from "@mailory/validation";
import { authorize, type Actor } from "../org/service";

export type ProfileDeps = { db: Database };
const PERM: Permission = "org:manage_billing";

/** Invoice details are visible to and editable by whoever may manage billing (owners) — nobody else. */
export async function getBillingProfileFor(deps: ProfileDeps, actor: Actor) {
  if (!authorize(actor, PERM))
    return { ok: false as const, code: "forbidden" as const };
  return {
    ok: true as const,
    profile: await getBillingProfile(deps.db, actor.organizationId),
  };
}

export async function saveBillingProfileFor(
  deps: ProfileDeps,
  actor: Actor,
  input: BillingProfileValues,
) {
  if (!authorize(actor, PERM))
    return { ok: false as const, code: "forbidden" as const };
  const profile = await upsertBillingProfile(deps.db, actor.organizationId, input);
  // The tax number itself stays out of the audit trail; the legal name and its kind are enough.
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "billing_profile.updated",
    entityType: "billing_profile",
    entityId: profile.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { legalName: profile.legalName, taxIdKind: profile.taxIdKind },
  });
  return { ok: true as const, profile };
}
