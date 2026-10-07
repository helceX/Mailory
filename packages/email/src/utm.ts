import type { CampaignUtm } from "@mailory/core/shared";

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;

/**
 * Adds utm_* parameters to http(s) links in rendered email HTML/text. Never touches mailto:/tel:, links that already
 * carry a utm_ parameter (the author's explicit choice wins), or our own system links (unsubscribe, view-in-browser)
 * — passed as `skipPrefixes`. Operates on `href="…"` attributes our renderer generated (always double-quoted, escaped).
 */
export function applyUtm(
  html: string,
  utm: CampaignUtm,
  skipPrefixes: string[] = [],
): string {
  if (!utm.enabled) return html;
  return html.replace(/href="(https?:\/\/[^"]*)"/g, (whole, raw: string) => {
    const decoded = raw.replace(/&amp;/g, "&");
    const tagged = tagUrl(decoded, utm, skipPrefixes);
    return tagged === decoded ? whole : `href="${tagged.replace(/&/g, "&amp;")}"`;
  });
}

export function applyUtmToText(
  text: string,
  utm: CampaignUtm,
  skipPrefixes: string[] = [],
): string {
  if (!utm.enabled) return text;
  return text.replace(/https?:\/\/[^\s<>"')]+/g, (url) =>
    tagUrl(url, utm, skipPrefixes),
  );
}

export function tagUrl(
  url: string,
  utm: CampaignUtm,
  skipPrefixes: string[] = [],
): string {
  if (skipPrefixes.some((p) => url.startsWith(p))) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if ([...parsed.searchParams.keys()].some((k) => k.startsWith("utm_"))) return url;
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (value) parsed.searchParams.set(`utm_${key}`, value);
  }
  return parsed.toString();
}
