/*
 * Pure webhook rules (browser-safe: no node:crypto). Signing lives in `webhook-sign.ts` (Node only).
 */

export const WEBHOOK_EVENTS = [
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.unsubscribed",
  "email.opened",
  "email.clicked",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "email.delivered": "E-posta teslim edildi",
  "email.bounced": "E-posta geri döndü (bounce)",
  "email.complained": "Alıcı şikayet etti",
  "email.unsubscribed": "Alıcı abonelikten çıktı",
  "email.opened": "E-posta açıldı",
  "email.clicked": "Bağlantıya tıklandı",
};

export const MAX_WEBHOOK_ENDPOINTS = 10;
export const MAX_DELIVERY_ATTEMPTS = 8;
/** Consecutive failed deliveries (each already retried) after which an endpoint is switched off. */
export const DISABLE_AFTER_FAILURES = 20;

/** Retry schedule: 30s, 2m, 10m, 30m, 2h, 6h, 12h — then the delivery is given up on. */
const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200, 21600, 43200];
export function webhookBackoffSeconds(attempt: number): number | null {
  return BACKOFF_SECONDS[attempt - 1] ?? null;
}

function ipv4ToInt(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** True for addresses an outbound webhook must never reach (loopback, private, link-local/metadata, CGNAT, etc.). */
export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ipv4ToInt(h);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPrivateAddress(mapped[1]!);
    // WHATWG URL normalizes ::ffff:1.2.3.4 to its hex form ::ffff:102:304.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^(fc|fd|fe[89ab])/.test(h) || h.startsWith("ff");
  }
  return false;
}

/**
 * Static check of a webhook target. Returns a Turkish reason, or null when acceptable. This cannot see DNS, so the
 * delivery worker re-checks the RESOLVED address as well (see apps/worker/src/jobs/webhook-deliver.ts).
 */
export function webhookUrlProblem(
  raw: string,
  options: { allowInsecure?: boolean } = {},
): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Geçerli bir adres girin.";
  }
  if (url.protocol !== "https:" && !(options.allowInsecure && url.protocol === "http:"))
    return "Adres https:// ile başlamalı.";
  if (url.username || url.password) return "Adres kullanıcı bilgisi içeremez.";
  if (raw.length > 500) return "Adres çok uzun.";
  const host = url.hostname.toLowerCase();
  // Development only: a receiver on this very machine is allowed; everything else internal stays blocked.
  if (
    options.allowInsecure &&
    (host === "localhost" || host === "127.0.0.1" || host === "[::1]")
  )
    return null;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  )
    return "Bu adrese istek gönderilemez.";
  if (isPrivateAddress(host)) return "Bu adrese istek gönderilemez.";
  return null;
}
