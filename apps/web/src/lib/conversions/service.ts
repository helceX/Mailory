import type { Permission } from "@mailory/core";
import { getContact, recordConversion, type Database } from "@mailory/db";
import type { ConversionInput } from "@mailory/validation";
import { authorize, type Actor } from "../org/service";

export type ConversionDeps = { db: Database; now?: () => Date };
const PERM: Permission = "contacts:write";

/** Records an outcome reported through the API. A foreign contact id is simply not found. */
export async function recordConversionFor(
  deps: ConversionDeps,
  actor: Actor,
  input: ConversionInput,
) {
  if (!authorize(actor, PERM))
    return { ok: false as const, code: "forbidden" as const };
  let contactId: string | null = null;
  if (input.contactId) {
    const c = await getContact(deps.db, actor.organizationId, input.contactId);
    if (!c) return { ok: false as const, code: "not_found" as const };
    contactId = c.id;
  }
  const r = await recordConversion(deps.db, actor.organizationId, {
    name: input.name,
    email: input.email ?? null,
    contactId,
    value: input.value,
    currency: input.currency,
    occurredAt: input.occurredAt
      ? new Date(input.occurredAt)
      : (deps.now ?? (() => new Date()))(),
    externalId: input.externalId ?? null,
  });
  return { ok: true as const, ...r };
}
