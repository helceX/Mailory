import { readUnsubscribeToken } from "@mailory/core";
import {
  asOrganizationId,
  getOrganization,
  getRecipient,
  markRecipientUnsubscribed,
  recordAudit,
  suppressForEvent,
  type Database,
} from "@mailory/db";

export type UnsubscribeLookup =
  | {
      ok: true;
      orgName: string;
      maskedEmail: string;
      email: string;
      recipientId: string;
      organizationId: string;
    }
  | { ok: false };

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

/** Validates the token and returns just enough to render a confirmation page (no unsubscribe happens here). */
export async function lookupUnsubscribe(
  deps: { db: Database; secret: string },
  token: string,
): Promise<UnsubscribeLookup> {
  const t = readUnsubscribeToken(deps.secret, token);
  if (!t) return { ok: false };
  const org = asOrganizationId(t.organizationId);
  const recipient = await getRecipient(deps.db, org, t.recipientId);
  if (!recipient) return { ok: false };
  const organization = await getOrganization(deps.db, org);
  return {
    ok: true,
    orgName: organization?.name ?? "",
    maskedEmail: maskEmail(recipient.email),
    email: recipient.email,
    recipientId: recipient.id,
    organizationId: t.organizationId,
  };
}

/**
 * Honors an unsubscribe from an email link or a mail client's one-click button. Idempotent: repeating it (scanners,
 * double clicks, retries) changes nothing and still reports success. The address goes on the suppression list, so it
 * is excluded from every future campaign of that organization, not only this one.
 */
export async function unsubscribeByToken(
  deps: { db: Database; secret: string; now?: () => Date },
  token: string,
  source: "link" | "one_click",
): Promise<{ ok: boolean }> {
  const found = await lookupUnsubscribe(deps, token);
  if (!found.ok) return { ok: false };
  const org = asOrganizationId(found.organizationId);
  const now = (deps.now ?? (() => new Date()))();
  await suppressForEvent(deps.db, org, found.email, "unsubscribe");
  await markRecipientUnsubscribed(deps.db, org, found.recipientId, now);
  await recordAudit(deps.db, {
    organizationId: org,
    userId: null,
    action: "contact.unsubscribed",
    entityType: "campaign_recipient",
    entityId: found.recipientId,
    metadata: { source },
  });
  return { ok: true };
}
