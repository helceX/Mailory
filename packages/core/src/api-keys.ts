import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * API keys look like `mlk_<prefix>_<secret>`. The prefix is a public lookup handle (shown in the UI so people can tell
 * keys apart); only the SHA-256 of the secret is stored. The secret is 32 random bytes, so a fast unsalted hash is safe
 * (same reasoning as session tokens in tokens.ts).
 */
export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const MAX_API_KEYS = 20;

const KEY_RE = /^mlk_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export function hashApiSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateApiKey() {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { key: `mlk_${prefix}_${secret}`, prefix, hash: hashApiSecret(secret) };
}

export function parseApiKey(raw: string): { prefix: string; hash: string } | null {
  const m = KEY_RE.exec(raw.trim());
  return m ? { prefix: m[1]!, hash: hashApiSecret(m[2]!) } : null;
}

export function apiHashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function apiScopeAllows(scope: ApiKeyScope, needs: ApiKeyScope): boolean {
  return needs === "read" || scope === "write";
}

/** Authorization: Bearer <key> (also accepts the key bare in `x-api-key`). */
export function bearerFrom(authorization: string | null, xApiKey: string | null) {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  return m?.[1] ?? xApiKey ?? null;
}
