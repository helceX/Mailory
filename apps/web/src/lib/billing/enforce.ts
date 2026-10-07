import { limitMessage, type EntitlementKey } from "@mailory/core";
import {
  checkEntitlement,
  getOrganization,
  type Database,
  type OrganizationId,
} from "@mailory/db";

export type PlanLimitFailure = { ok: false; code: "plan_limit"; message: string };
export type SuspendedFailure = { ok: false; code: "suspended"; message: string };

/** One call site per guarded action: returns the failure to show, or null when the plan allows it. */
export async function enforce(
  db: Database,
  organizationId: OrganizationId,
  key: EntitlementKey,
  delta = 1,
  now?: Date,
): Promise<PlanLimitFailure | null> {
  const c = await checkEntitlement(db, organizationId, key, delta, now);
  return c.allowed ? null : { ok: false, code: "plan_limit", message: limitMessage(c) };
}

/** A suspended organization cannot start or schedule any sending (the engine also pauses what is already running). */
export async function ensureNotSuspended(
  db: Database,
  organizationId: OrganizationId,
): Promise<SuspendedFailure | null> {
  const org = await getOrganization(db, organizationId);
  return org?.suspendedAt
    ? {
        ok: false,
        code: "suspended",
        message:
          "Bu çalışma alanı askıya alınmış; gönderim yapılamaz. Destek için yöneticinizle iletişime geçin.",
      }
    : null;
}
