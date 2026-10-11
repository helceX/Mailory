/*
 * Pure helpers for importing a purchased/third-party HTML email (no I/O): pull the <body> and <style> out of a full
 * document, translate the merge tags other tools use, find local asset references, and make sure the result has a real
 * unsubscribe link. Everything here is best-effort fidelity work; SAFETY comes from the sanitizers, which always run on
 * the result (import time and again at render time).
 */

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

export function extractParts(source: string): {
  body: string;
  css: string;
  title: string;
} {
  let html = source.replace(/<!--[\s\S]*?-->/g, "");
  const css = [...html.matchAll(STYLE_BLOCK)].map((m) => m[1]!.trim()).join("\n");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  html = html.replace(STYLE_BLOCK, "");
  const bodyMatch = /<body\b([^>]*)>([\s\S]*?)(?:<\/body>|$)/i.exec(html);
  let body = bodyMatch ? bodyMatch[2]! : html.replace(/<head\b[\s\S]*?<\/head>/i, "");
  body = body.replace(/<\/?(html|head|body|meta|link|title)\b[^>]*>/gi, "");
  // Many templates colour the page through <body bgcolor/style>; keep that as a wrapper.
  const attrs = bodyMatch?.[1] ?? "";
  const bg = /bgcolor\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const style = /style\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
  if (bg || style)
    body = `<div ${bg ? `bgcolor="${bg}" ` : ""}style="${style ?? ""}">${body}</div>`;
  return { body: body.trim(), css, title };
}

/** Merge tags from other email tools → Mailory's. Unknown tags are left alone (the editor/readiness check shows them). */
const TAG_MAP: [RegExp, string][] = [
  [/\*\|\s*(?:UNSUB|UNSUBSCRIBE)(?::[^|]*)?\s*\|\*/gi, "{{unsubscribe_url}}"],
  [
    /\*\|\s*(?:ARCHIVE|MC:VIEW|VIEW_IN_BROWSER|FORWARD)\s*\|\*/gi,
    "{{view_in_browser_url}}",
  ],
  [/\*\|\s*FNAME\s*\|\*/gi, "{{first_name}}"],
  [/\*\|\s*LNAME\s*\|\*/gi, "{{last_name}}"],
  [/\*\|\s*EMAIL\s*\|\*/gi, "{{email}}"],
  [/\*\|\s*CURRENT_YEAR\s*\|\*/gi, "{{current_year}}"],
  [/\*\|\s*LIST:COMPANY\s*\|\*/gi, "{{org_name}}"],
  [
    /\[unsubscribe\]|%%unsubscribe_url%%|\{\{\{?\s*unsubscribe(?:_url)?\s*\}?\}\}|\{\$unsubscribe\}|\{\{\s*unsubscribe_link\s*\}\}/gi,
    "{{unsubscribe_url}}",
  ],
  [
    /%%(?:view_in_browser|webversion)%%|\{\{\s*webversion\s*\}\}|\[weblink\]/gi,
    "{{view_in_browser_url}}",
  ],
  [
    /%%first_?name%%|\{\{\s*first_?name\s*\}\}|\[first_?name\]|\{\$name\}/gi,
    "{{first_name}}",
  ],
  [/%%last_?name%%|\{\{\s*last_?name\s*\}\}|\[last_?name\]/gi, "{{last_name}}"],
  [/%%email%%|\[email\]|\{\$email\}/gi, "{{email}}"],
];
export function mapMergeTags(html: string): { html: string; mapped: string[] } {
  const mapped = new Set<string>();
  let out = html;
  for (const [re, to] of TAG_MAP)
    out = out.replace(re, (m) => {
      mapped.add(`${m} → ${to}`);
      return to;
    });
  return { html: out, mapped: [...mapped] };
}

export const UNSUBSCRIBE_FOOTER =
  '<div style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#777777;padding:16px;">Bu e-postaları almak istemiyorsanız <a href="{{unsubscribe_url}}" style="color:#555555;">abonelikten çıkabilirsiniz</a>.</div>';

/** A marketing email must carry a working unsubscribe link: add a plain footer when the source has none. */
export function ensureUnsubscribe(html: string): { html: string; added: boolean } {
  if (/href\s*=\s*["']\s*\{\{\s*unsubscribe_url\s*\}\}\s*["']/i.test(html))
    return { html, added: false };
  return { html: `${html}\n${UNSUBSCRIBE_FOOTER}`, added: true };
}

/** Relative (importable) references: img src, legacy background="", and url(...) in inline styles or CSS. */
export function findLocalRefs(html: string, css: string): string[] {
  const refs = new Set<string>();
  const isLocal = (v: string) =>
    v !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{\{)/i.test(v) && !v.startsWith("/a/");
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi))
    if (isLocal(m[1]!.trim())) refs.add(m[1]!.trim());
  for (const m of html.matchAll(/\bbackground\s*=\s*["']([^"']+)["']/gi))
    if (isLocal(m[1]!.trim())) refs.add(m[1]!.trim());
  for (const m of `${html}\n${css}`.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi))
    if (isLocal(m[1]!.trim())) refs.add(m[1]!.trim());
  return [...refs];
}

/** Applies `map` (original reference → replacement URL) everywhere findLocalRefs looks; missing keys are removed. */
export function replaceLocalRefs(text: string, map: Map<string, string>): string {
  const swap = (ref: string) => map.get(ref.trim());
  return text
    .replace(
      /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
      (m, pre: string, q: string, v: string) => {
        const to = swap(v);
        return to ? `${pre}${q}${to}${q}` : m;
      },
    )
    .replace(
      /(\bbackground\s*=\s*)(["'])([^"']+)\2/gi,
      (m, pre: string, q: string, v: string) => {
        const to = swap(v);
        return to ? `${pre}${q}${to}${q}` : m;
      },
    )
    .replace(/url\(\s*(["']?)([^"')]+?)\1\s*\)/gi, (m, _q: string, v: string) => {
      const to = swap(v);
      return to ? `url("${to}")` : m;
    });
}

/** Resolves `ref` against the directory of the HTML file inside an archive; null when it would escape the archive. */
export function resolveArchivePath(htmlPath: string, ref: string): string | null {
  const clean = decodeURIComponent(ref.split(/[?#]/)[0] ?? "").replace(/\\/g, "/");
  const parts = htmlPath.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}
