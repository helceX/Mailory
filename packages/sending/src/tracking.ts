import { createHmac } from "node:crypto";

/** Distinct http(s) destinations in rendered HTML (anchor hrefs only), excluding our own system links. */
export function trackableUrls(html: string, skipPrefixes: string[]): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="(https?:\/\/[^"]*)"/g)) {
    const url = m[1]!.replace(/&amp;/g, "&");
    if (!skipPrefixes.some((p) => url.startsWith(p))) out.add(url);
  }
  return [...out];
}

/** Replaces each tracked destination with its redirect URL; everything else is left byte-for-byte. */
export function rewriteLinks(
  html: string,
  redirects: Map<string, string>,
  mode: "html" | "text",
): string {
  if (redirects.size === 0) return html;
  if (mode === "html")
    return html.replace(/href="(https?:\/\/[^"]*)"/g, (whole, raw: string) => {
      const to = redirects.get(raw.replace(/&amp;/g, "&"));
      return to ? `href="${to}"` : whole;
    });
  return html.replace(/https?:\/\/[^\s<>"')]+/g, (url) => redirects.get(url) ?? url);
}

export function openPixelHtml(url: string): string {
  return `<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
}
export function injectPixel(html: string, pixel: string): string {
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${pixel}</body>`)
    : html + pixel;
}

/** 1×1 transparent GIF. */
export const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export type Device = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

const BOT_UA =
  /bot|crawl|spider|slurp|preview|scan|fetch|monitor|headless|python-requests|curl\/|wget|go-http-client|java\/|okhttp|libwww|proofpoint|mimecast|barracuda|forcepoint|symantec|trendmicro|urlscan|safelinks|microsoft office|outlook-ios\/.*prefetch/i;

/** Coarse device class from the user agent; the raw agent string is never stored. */
export function classifyDevice(ua: string | null | undefined): Device {
  if (!ua) return "unknown";
  if (BOT_UA.test(ua)) return "bot";
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

/** Clicks faster than this after sending are link scanners, not people. */
export const SCANNER_CLICK_MS = 4000;

export function looksLikeBot(input: {
  ua: string | null | undefined;
  purpose?: string | null;
  type: "open" | "click";
  msSinceSent: number | null;
}): boolean {
  if (classifyDevice(input.ua) === "bot") return true;
  if (input.purpose && /prefetch|preview/i.test(input.purpose)) return true;
  if (
    input.type === "click" &&
    input.msSinceSent !== null &&
    input.msSinceSent < SCANNER_CLICK_MS
  )
    return true;
  return false;
}

/**
 * Daily-rotating salted hash of the IP: lets us notice repeated hits from one place within a day, but is not
 * reversible and cannot link a person across days (KVKK data minimisation).
 */
export function hashIp(
  secret: string,
  ip: string | null | undefined,
  now: Date,
): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", secret)
    .update(`iphash:${day}:${ip}`)
    .digest("hex")
    .slice(0, 16);
}
