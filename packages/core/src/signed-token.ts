import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless, tamper-proof tokens for links that live inside sent emails (unsubscribe). They carry only opaque ids,
 * never expire (an unsubscribe link must keep working years later), and are bound to a purpose so a token minted for
 * one use can never be replayed for another. The key is derived from the app secret per purpose.
 */
const b64 = (buf: Buffer) => buf.toString("base64url");

function mac(secret: string, purpose: string, body: string): Buffer {
  const key = createHmac("sha256", secret)
    .update(`mailory:token:v1:${purpose}`)
    .digest();
  return createHmac("sha256", key).update(body).digest();
}

export function signToken(secret: string, purpose: string, payload: string[]): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64(mac(secret, purpose, body))}`;
}

/** Returns the payload, or null for anything malformed, forged or minted for another purpose. */
export function verifyToken(
  secret: string,
  purpose: string,
  token: string,
): string[] | null {
  if (token.length > 512) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(secret, purpose, body);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export const unsubscribeToken = (
  secret: string,
  organizationId: string,
  recipientId: string,
) => signToken(secret, "unsubscribe", [organizationId, recipientId]);

export function readUnsubscribeToken(secret: string, token: string) {
  const p = verifyToken(secret, "unsubscribe", token);
  return p && p.length === 2 ? { organizationId: p[0]!, recipientId: p[1]! } : null;
}
