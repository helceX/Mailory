import {
  EMAIL_FONTS,
  SOCIAL_LABELS,
  isSafeUrl,
  type Block,
  type EmailDoc,
  type LeafBlock,
} from "@mailory/core/shared";
import { escapeHtml } from "./escape";
import { applyMerge, type MergeValues } from "./merge";
import { inlineToHtml, inlineToText } from "./markup";
import { sanitizeHtmlBlock } from "./sanitize";

export type RenderOptions = {
  values: MergeValues;
  /** Absolute base for our own `/a/<id>` asset paths. */
  appUrl: string;
  /** Resolved brand logo, used by logo blocks whose own `src` is empty. */
  brandLogoUrl?: string;
  subject?: string;
  sanitize?: (html: string) => string;
};
export type RenderWarning = {
  code: "image_missing_src" | "logo_missing";
  blockId: string;
};
export type RenderResult = {
  html: string;
  text: string;
  unknownKeys: string[];
  warnings: RenderWarning[];
};

const WHOLE_TOKEN = /^\{\{\s*([a-z_]+)\s*\}\}$/i;

export function renderEmail(doc: EmailDoc, options: RenderOptions): RenderResult {
  const { settings } = doc;
  const unknown = new Set<string>();
  const warnings: RenderWarning[] = [];
  const sanitize = options.sanitize ?? sanitizeHtmlBlock;
  const font = EMAIL_FONTS[settings.font].stack.replace(/"/g, "'");
  const base = options.appUrl.replace(/\/$/, "");

  // ---- context helpers (each one produces output that is already safe for its context) ----------
  const body = (text: string) =>
    applyMerge(
      inlineToHtml(text, settings.linkColor),
      options.values,
      escapeHtml,
      unknown,
    );
  const attr = (text: string) =>
    applyMerge(escapeHtml(text), options.values, escapeHtml, unknown);

  const href = (raw: string): string => {
    if (!raw || !isSafeUrl(raw, { allowMailto: true })) return "#";
    const whole = WHOLE_TOKEN.exec(raw.trim());
    const merged = whole
      ? applyMerge(raw.trim(), options.values, (v) => v, unknown)
      : applyMerge(raw, options.values, encodeURIComponent, unknown);
    // The merged result must still be an allowed URL (e.g. a system token must resolve to https).
    return isSafeUrl(merged, { allowMailto: true }) ? escapeHtml(merged) : "#";
  };
  const src = (raw: string): string => {
    const absolute = raw.startsWith("/a/") ? `${base}${raw}` : raw;
    return isSafeUrl(absolute) ? escapeHtml(absolute) : "";
  };

  const heading = (b: Extract<LeafBlock, { type: "heading" }>) => {
    const size = { 1: 28, 2: 22, 3: 18 }[b.level];
    return `<h${b.level} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:700;color:${settings.headingColor};text-align:${b.align};">${body(b.text)}</h${b.level}>`;
  };
  const paragraph = (b: Extract<LeafBlock, { type: "paragraph" }>) =>
    `<p style="margin:0;font-family:${font};font-size:16px;line-height:1.6;color:${settings.textColor};text-align:${b.align};">${body(b.text)}</p>`;

  const image = (b: Extract<LeafBlock, { type: "image" }>) => {
    const url = src(b.src);
    if (!url) {
      warnings.push({ code: "image_missing_src", blockId: b.id });
      return "";
    }
    const img = `<img src="${url}" alt="${attr(b.alt)}" width="${Math.round((settings.width - 48) * (b.widthPercent / 100))}" style="display:block;border:0;outline:none;text-decoration:none;width:${b.widthPercent}%;max-width:100%;height:auto;${b.align === "center" ? "margin:0 auto;" : b.align === "right" ? "margin-left:auto;" : ""}">`;
    return b.href
      ? `<a href="${href(b.href)}" style="text-decoration:none;">${img}</a>`
      : img;
  };

  const button = (b: Extract<LeafBlock, { type: "button" }>) => {
    const outline = b.variant === "outline";
    const bg = outline ? "transparent" : settings.buttonColor;
    const color = outline ? settings.buttonColor : settings.buttonTextColor;
    const border = outline
      ? `2px solid ${settings.buttonColor}`
      : `2px solid ${settings.buttonColor}`;
    const align =
      b.align === "center" ? "center" : b.align === "right" ? "right" : "left";
    // Table-cell button: renders reliably in Outlook, where padding on <a> is unreliable.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:${align === "center" ? "0 auto" : "0"};${align === "right" ? "margin-left:auto;" : ""}"><tr><td align="center" bgcolor="${outline ? settings.contentBackground : settings.buttonColor}" style="border-radius:${settings.radius}px;background:${bg};border:${border};"><a href="${href(b.href)}" style="display:inline-block;padding:12px 28px;font-family:${font};font-size:16px;font-weight:700;line-height:1.2;color:${color};text-decoration:none;border-radius:${settings.radius}px;">${body(b.label)}</a></td></tr></table>`;
  };

  const social = (b: Extract<LeafBlock, { type: "social" }>) =>
    `<p style="margin:0;font-family:${font};font-size:14px;line-height:1.6;text-align:${b.align};">${b.links
      .map(
        (l) =>
          `<a href="${href(l.url)}" style="color:${settings.linkColor};text-decoration:underline;">${escapeHtml(SOCIAL_LABELS[l.network])}</a>`,
      )
      .join(" &nbsp;·&nbsp; ")}</p>`;

  const quote = (b: Extract<LeafBlock, { type: "quote" }>) =>
    `<blockquote style="margin:0;padding:8px 0 8px 16px;border-left:4px solid ${settings.linkColor};font-family:${font};font-size:18px;line-height:1.5;font-style:italic;color:${settings.textColor};">${body(b.text)}${b.author ? `<br><span style="display:inline-block;margin-top:8px;font-size:14px;font-style:normal;color:#6b7280;">— ${body(b.author)}</span>` : ""}</blockquote>`;

  const logo = (b: Extract<LeafBlock, { type: "logo" }>) => {
    const url = b.src
      ? src(b.src)
      : options.brandLogoUrl
        ? src(options.brandLogoUrl)
        : "";
    if (!url) {
      warnings.push({ code: "logo_missing", blockId: b.id });
      return "";
    }
    return `<img src="${url}" alt="${attr(b.alt)}" width="${b.widthPx}" style="display:block;border:0;outline:none;width:${b.widthPx}px;max-width:100%;height:auto;${b.align === "center" ? "margin:0 auto;" : b.align === "right" ? "margin-left:auto;" : ""}">`;
  };

  const video = (b: Extract<LeafBlock, { type: "video" }>) => {
    const url = src(b.thumbnailSrc);
    const thumb = url
      ? `<a href="${href(b.href)}" style="text-decoration:none;"><img src="${url}" alt="${attr(b.alt)}" width="${settings.width - 48}" style="display:block;border:0;width:100%;max-width:100%;height:auto;"></a>`
      : "";
    return `${thumb}<p style="margin:8px 0 0;font-family:${font};font-size:14px;text-align:center;"><a href="${href(b.href)}" style="color:${settings.linkColor};text-decoration:underline;">${body(b.alt || "Videoyu izle")}</a></p>`;
  };

  const footer = (b: Extract<LeafBlock, { type: "footer" }>) => {
    const unsubscribe = b.showUnsubscribe
      ? `<br><a href="${href("{{unsubscribe_url}}")}" style="color:#6b7280;text-decoration:underline;">Abonelikten çık</a>`
      : "";
    return `<p style="margin:0;font-family:${font};font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">${body(b.text)}${unsubscribe}</p>`;
  };

  const leaf = (b: LeafBlock): string => {
    switch (b.type) {
      case "heading":
        return heading(b);
      case "paragraph":
        return paragraph(b);
      case "image":
        return image(b);
      case "button":
        return button(b);
      case "divider":
        return `<hr style="margin:0;border:0;border-top:1px solid #e5e7eb;">`;
      case "spacer":
        return `<div style="height:${b.height}px;line-height:${b.height}px;font-size:1px;">&nbsp;</div>`;
      case "social":
        return social(b);
      case "quote":
        return quote(b);
      case "logo":
        return logo(b);
      case "video":
        return video(b);
      case "html":
        return `<div style="font-family:${font};font-size:16px;line-height:1.6;color:${settings.textColor};">${applyMerge(sanitize(b.html), options.values, escapeHtml, unknown)}</div>`;
      case "footer":
        return footer(b);
    }
  };

  const row = (inner: string, padding = "8px 24px") =>
    inner ? `<tr><td class="px" style="padding:${padding};">${inner}</td></tr>` : "";

  const block = (b: Block): string => {
    if (b.type === "columns") {
      const n = b.columns.length;
      const cells = b.columns
        .map((col, i) => {
          const inner = col
            .map(leaf)
            .filter(Boolean)
            .map((h) => `<div style="padding:4px 0;">${h}</div>`)
            .join("");
          return `<td class="col" width="${Math.floor(100 / n)}%" valign="top" style="padding:0 ${i === n - 1 ? 0 : 12}px 0 0;">${inner}</td>`;
        })
        .join("");
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
      );
    }
    if (b.type === "footer") return row(leaf(b), "24px 24px");
    if (b.type === "spacer" || b.type === "divider") return row(leaf(b), "0 24px");
    return row(leaf(b));
  };

  const rows = doc.blocks.map(block).join("");
  const preheader = settings.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${settings.backgroundColor};">${attr(settings.preheader)}${"&nbsp;&zwnj;".repeat(60)}</div>`
    : "";

  const html = `<!doctype html>
<html lang="tr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<title>${escapeHtml(options.subject ? applyMerge(options.subject, options.values, (v) => v) : "")}</title>
<style>
@media only screen and (max-width:620px){
  .container{width:100%!important}
  .px{padding-left:16px!important;padding-right:16px!important}
  .col{display:block!important;width:100%!important;padding:0 0 12px 0!important}
  img{height:auto!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${settings.backgroundColor};-webkit-text-size-adjust:100%;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${settings.backgroundColor}" style="background:${settings.backgroundColor};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="container" width="${settings.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${settings.contentBackground}" style="width:100%;max-width:${settings.width}px;background:${settings.contentBackground};border-radius:${settings.radius}px;">
${rows}
</table>
</td></tr>
</table>
</body>
</html>`;

  return { html, text: renderText(doc, options), unknownKeys: [...unknown], warnings };
}

/** Plain-text alternative: required for deliverability and for clients that block HTML. */
export function renderText(
  doc: EmailDoc,
  options: Pick<RenderOptions, "values" | "appUrl">,
): string {
  const plain = (s: string) => applyMerge(inlineToText(s), options.values, (v) => v);
  const url = (raw: string) =>
    isSafeUrl(raw, { allowMailto: true })
      ? applyMerge(raw, options.values, (v) => v)
      : "";
  const leafText = (b: LeafBlock): string => {
    switch (b.type) {
      case "heading":
        return b.level === 1 ? plain(b.text).toUpperCase() : plain(b.text);
      case "paragraph":
        return plain(b.text);
      case "button":
        return `${plain(b.label)}: ${url(b.href)}`;
      case "image":
        return b.alt ? `[${plain(b.alt)}]` : "";
      case "video":
        return `${plain(b.alt || "Video")}: ${url(b.href)}`;
      case "quote":
        return `"${plain(b.text)}"${b.author ? ` — ${plain(b.author)}` : ""}`;
      case "social":
        return b.links
          .map((l) => `${SOCIAL_LABELS[l.network]}: ${url(l.url)}`)
          .join("\n");
      case "divider":
        return "----------";
      case "footer":
        return `${plain(b.text)}${b.showUnsubscribe ? `\nAbonelikten çık: ${url("{{unsubscribe_url}}")}` : ""}`;
      case "html":
        return plain(
          b.html
            .replace(/<(br|\/p|\/div|\/h[1-4]|\/li|\/tr)\s*\/?>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&"),
        );
      default:
        return "";
    }
  };
  const lines: string[] = [];
  if (doc.settings.preheader) lines.push(plain(doc.settings.preheader));
  for (const b of doc.blocks) {
    if (b.type === "columns")
      for (const col of b.columns) for (const child of col) lines.push(leafText(child));
    else lines.push(leafText(b));
  }
  return lines.filter((l) => l.trim() !== "").join("\n\n") + "\n";
}
