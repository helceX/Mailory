export type OriginInput = {
  origin: string | null;
  referer: string | null;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  /** request.nextUrl.origin — wrong behind a proxy (standalone reports 0.0.0.0). */
  nextOrigin: string;
  /** Configured public URL (APP_URL). */
  appUrl: string | undefined;
};

function first(value: string | null): string | null {
  const head = value?.split(",")[0]?.trim();
  return head ? head : null;
}

/**
 * Origins a genuine same-site browser request may carry. Behind a TLS proxy
 * (Railway/Cloudflare) the public origin is rebuilt from forwarded/Host headers
 * and APP_URL; a cross-site page cannot forge Origin from a victim's browser.
 */
export function trustedOrigins(input: OriginInput): Set<string> {
  const trusted = new Set<string>([input.nextOrigin]);
  const host = first(input.forwardedHost) ?? first(input.host);
  if (host) {
    const proto =
      first(input.forwardedProto) ??
      new URL(input.nextOrigin).protocol.replace(":", "");
    trusted.add(`${proto}://${host}`);
  }
  if (input.appUrl) {
    try {
      trusted.add(new URL(input.appUrl).origin);
    } catch {
      // malformed APP_URL contributes nothing
    }
  }
  return trusted;
}

/** CSRF check for mutating requests: Origin (or Referer) must be trusted; neither → reject. */
export function isSameOrigin(input: OriginInput): boolean {
  const trusted = trustedOrigins(input);
  if (input.origin) return trusted.has(input.origin);
  if (input.referer) {
    try {
      return trusted.has(new URL(input.referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * One trusted hop (the platform proxy) appends the address it saw to the END of
 * X-Forwarded-For; earlier entries are client-controlled. Use the last one so
 * rotating the header cannot mint fresh rate-limit buckets.
 */
export function clientIpFrom(forwardedFor: string | null): string {
  if (!forwardedFor) return "unknown";
  const hops = forwardedFor.split(",").map((hop) => hop.trim());
  return hops[hops.length - 1] || "unknown";
}
