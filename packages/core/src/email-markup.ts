import { MERGE_TOKEN, isSafeUrl } from "./email-doc";
import { applyMergeFilter } from "./turkish";

/**
 * Pure text helpers shared by the server renderer and the editor's canvas preview. Everything here
 * escapes first and only ever emits a fixed set of tags, so its output is safe to inject as HTML.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/**
 * Inline "markdown-lite": **bold**, _italic_, [label](url), newlines. The input is HTML-escaped FIRST so
 * authors can never inject markup; link targets must pass the same allow-list as buttons.
 */
export function inlineToHtml(source: string, linkColor: string): string {
  let html = escapeHtml(source);
  html = html.replace(
    /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g,
    (_m, label: string, url: string) => {
      const raw = url.replace(/&amp;/g, "&");
      return isSafeUrl(raw, { allowMailto: true })
        ? `<a href="${url}" style="color:${linkColor};text-decoration:underline;">${label}</a>`
        : label;
    },
  );
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  return html.replace(/\r?\n/g, "<br>");
}

export function inlineToText(source: string): string {
  return source
    .replace(
      /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g,
      (_m, label: string, url: string) =>
        isSafeUrl(url, { allowMailto: true }) ? `${label} (${url})` : label,
    )
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/g, "$1$2");
}

export type MergeValues = Record<string, string | number | boolean | null | undefined>;
const present = (v: unknown): v is string | number | boolean =>
  v !== null && v !== undefined && String(v).trim() !== "";

/**
 * Replaces `{{key}}` / `{{key|fallback}}`. Callers pass text ALREADY escaped for its target context, so the
 * author's fallback is safe as-is; only the contact's value (untrusted data) goes through `encode`.
 */
export function applyMerge(
  text: string,
  values: MergeValues,
  encode: (value: string) => string,
  unknown?: Set<string>,
): string {
  return text.replace(
    MERGE_TOKEN,
    (_match, rawKey: string, filter?: string, fallback?: string) => {
      const key = rawKey.toLowerCase();
      if (!(key in values)) unknown?.add(key);
      const value = values[key];
      if (present(value)) return encode(applyMergeFilter(String(value), filter));
      return fallback !== undefined ? fallback.trim() : "";
    },
  );
}
