import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe-style signing: `t=<unix seconds>,v1=<hex hmac of "<t>.<body>">`. The receiver recomputes the HMAC with the
 * endpoint secret and rejects timestamps older than its tolerance (replay protection).
 */
export function signWebhook(secret: string, body: string, at: Date = new Date()) {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  options: { now?: Date; toleranceSeconds?: number } = {},
): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(m[1])) > (options.toleranceSeconds ?? 300)) return false;
  const expected = createHmac("sha256", secret).update(`${m[1]}.${body}`).digest();
  const given = Buffer.from(m[2]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
