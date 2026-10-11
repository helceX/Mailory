import sanitizeHtml from "sanitize-html";
import { isSafeUrl, type EmailDoc } from "@mailory/core/shared";
import { escapeHtml } from "./escape";
import { applyMerge, type MergeValues } from "./merge";
import { sanitizeInlineStyle, sanitizeRawCss } from "./raw-css";

const WHOLE_TOKEN = /^\{\{\s*([a-z_.]+)\s*\}\}$/i;
const MERGE_ANY = /\{\{\s*[a-z_.]+\s*\}\}/i;
const OUR_ASSET = /^\/a\/[0-9a-f-]{36}$/i;

const TAGS = [
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "img",
  "blockquote",
  "small",
  "center",
  "font",
  "sup",
  "sub",
  "pre",
  "code",
  "abbr",
];
const ATTRS = [
  "style",
  "class",
  "id",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "role",
  "dir",
  "lang",
  "title",
];

/**
 * Allow-list sanitizer for a whole imported email body. Tags/attributes/styles are restricted to what email needs;
 * links must be absolute http(s)/mailto/tel or contain merge tokens; images absolute https or our own `/a/<id>` assets.
 * `values` (when given) resolves merge tokens inside href targets with the right encoding for a URL context.
 */
export function sanitizeRawEmailHtml(
  html: string,
  context: { appUrl: string; values?: MergeValues; unknown?: Set<string> } = {
    appUrl: "",
  },
): string {
  const base = context.appUrl.replace(/\/$/, "");
  const mergeUrl = (raw: string): string | null => {
    const value = raw.trim();
    if (!context.values) {
      // Template-time (import/save): keep tokens, accept only shapes that can become a safe URL.
      return /^(https?:|mailto:|tel:)/i.test(value) || WHOLE_TOKEN.test(value)
        ? value
        : null;
    }
    const whole = WHOLE_TOKEN.exec(value);
    const merged = whole
      ? applyMerge(value, context.values, (v) => v, context.unknown)
      : applyMerge(value, context.values, encodeURIComponent, context.unknown);
    return isSafeUrl(merged, { allowMailto: true }) || /^tel:/i.test(merged)
      ? merged
      : null;
  };
  return sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: {
      "*": ATTRS,
      a: ["href", "title", "target", "rel", ...ATTRS],
      img: ["src", "alt", "width", "height", ...ATTRS],
      td: [...ATTRS],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tag, attribs) => {
        const next = { ...attribs };
        if (next.style !== undefined) {
          const cleaned = sanitizeInlineStyle(next.style);
          if (cleaned) next.style = cleaned;
          else delete next.style;
        }
        // class/id may only contain plain identifier characters (they are selector targets for the cleaned CSS).
        for (const k of ["class", "id"] as const)
          if (next[k] !== undefined && !/^[\w\s-]{1,200}$/.test(next[k]!))
            delete next[k];
        return { tagName: tag, attribs: next };
      },
      a: (tag, attribs) => {
        const { href, ...rest } = attribs;
        const target = href ? mergeUrl(href) : null;
        return {
          tagName: tag,
          attribs: {
            ...rest,
            ...(target ? { href: target } : {}),
            rel: "noopener noreferrer nofollow",
          },
        };
      },
      img: (tag, attribs) => {
        const raw = (attribs.src ?? "").trim();
        const ok = OUR_ASSET.test(raw) || /^https:\/\//i.test(raw);
        if (!ok) return { tagName: "discarded-img", attribs: {} };
        return {
          tagName: tag,
          attribs: { ...attribs, src: raw.startsWith("/a/") ? `${base}${raw}` : raw },
        };
      },
    },
  });
}

/** Plain-text alternative derived from the (already sanitized) HTML. */
export function rawHtmlToText(html: string): string {
  return (
    html
      .replace(
        /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href: string, inner: string) => {
          const label = inner.replace(/<[^>]*>/g, "").trim();
          const url = href.replace(/&amp;/g, "&");
          return label && label !== url ? `${label} (${url})` : url;
        },
      )
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/table)\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

export type RawRenderOptions = {
  values: MergeValues;
  appUrl: string;
  subject?: string;
};

/** Renders an imported HTML email for one recipient. Everything stored is re-sanitized here, always. */
export function renderRawEmail(doc: EmailDoc, options: RawRenderOptions) {
  const raw = doc.raw!;
  const unknown = new Set<string>();
  // 1) sanitize (resolving href tokens), 2) merge tokens in text/attributes with HTML escaping.
  const safeBody = sanitizeRawEmailHtml(raw.html, {
    appUrl: options.appUrl,
    values: options.values,
    unknown,
  });
  const body = applyMerge(safeBody, options.values, escapeHtml, unknown);
  const css = sanitizeRawCss(raw.css);
  const pre = doc.settings.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:transparent;">${applyMerge(escapeHtml(doc.settings.preheader), options.values, escapeHtml, unknown)}</div>`
    : "";
  const title = escapeHtml(
    options.subject ? applyMerge(options.subject, options.values, (v) => v) : "",
  );
  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${title}</title>
${css ? `<style>\n${css}\n</style>` : ""}
</head>
<body style="margin:0;padding:0;-webkit-text-size-adjust:100%;">
${pre}${body}
</body>
</html>`;
  const text = applyMerge(rawHtmlToText(safeBody), options.values, (v) => v, unknown);
  return { html, text, unknownKeys: [...unknown], warnings: [] as never[] };
}

export { MERGE_ANY };
