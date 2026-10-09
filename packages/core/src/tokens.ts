import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque secrets (session cookies, emailed verification/reset links) are 32
 * random bytes. Only the SHA-256 is stored, so a database leak does not yield
 * usable sessions or links. High-entropy input makes an unsalted fast hash safe.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
