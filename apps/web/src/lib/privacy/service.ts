import type { Permission } from "@mailory/core";
import {
  eraseContact,
  exportContactData,
  getOrganization,
  recordAudit,
  softDeleteOrganization,
  type Database,
} from "@mailory/db";
import { authorize, type Actor } from "../org/service";

export type PrivacyDeps = { db: Database; now?: () => Date };
type Code = "forbidden" | "not_found" | "invalid";
export type Failure = { ok: false; code: Code; message?: string };
const fail = (code: Code, message?: string): Failure => ({ ok: false, code, message });
const need = (a: Actor, p: Permission) => authorize(a, p);
const clock = (d: PrivacyDeps) => (d.now ?? (() => new Date()))();

function audit(
  deps: PrivacyDeps,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}

/** Right of access: everything held about one person. Exporting personal data is itself audited. */
export async function exportContactFor(
  deps: PrivacyDeps,
  actor: Actor,
  contactId: string,
) {
  if (!need(actor, "contacts:export")) return fail("forbidden");
  const data = await exportContactData(deps.db, actor.organizationId, contactId);
  if (!data) return fail("not_found");
  await audit(deps, actor, "contact.data_exported", "contact", contactId);
  return { ok: true as const, data };
}

/**
 * Right to erasure. Admin-level (not every editor): it is irreversible. The audit entry names the contact by id only —
 * never by address — so the log does not re-introduce the data it just removed.
 */
export async function eraseContactFor(
  deps: PrivacyDeps,
  actor: Actor,
  contactId: string,
) {
  if (!need(actor, "org:manage_settings")) return fail("forbidden");
  const result = await eraseContact(deps.db, actor.organizationId, contactId);
  if (!result) return fail("not_found");
  await audit(deps, actor, "contact.erased", "contact", contactId, result);
  return { ok: true as const, ...result };
}

/** Owner closes the workspace; typing its exact name is the confirmation. Reversible by a platform admin for 30 days. */
export async function requestOrganizationDeletionFor(
  deps: PrivacyDeps,
  actor: Actor,
  confirmName: string,
) {
  if (!need(actor, "org:delete")) return fail("forbidden");
  const org = await getOrganization(deps.db, actor.organizationId);
  if (!org) return fail("not_found");
  if (
    confirmName.trim().toLocaleLowerCase("tr-TR") !==
    org.name.trim().toLocaleLowerCase("tr-TR")
  )
    return fail("invalid", "Çalışma alanı adı eşleşmiyor.");
  await audit(deps, actor, "organization.deletion_requested", "organization", org.id, {
    name: org.name,
  });
  const done = await softDeleteOrganization(deps.db, actor.organizationId, clock(deps));
  return done ? { ok: true as const } : fail("not_found");
}
