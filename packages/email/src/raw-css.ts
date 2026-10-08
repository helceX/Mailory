/*
 * Conservative CSS filter for imported HTML emails. It keeps what email design actually needs (class/tag/id rules and
 * @media queries for responsiveness) and drops everything that can load things, run things or overlay the page:
 * @font-face/@keyframes/@charset…, url() to anything but https, expression()/behavior/binding, `position`, `z-index`,
 * `content`, backslash escapes. The result is only ever placed in a <style> in our own preview/"view in browser" page
 * (sandboxed / CSP default-src 'none') and in the recipient's inbox.
 */
const PROPS = new Set(
  `color background background-color background-image background-repeat background-position background-size
border border-top border-right border-bottom border-left border-color border-style border-width border-radius
border-top-color border-right-color border-bottom-color border-left-color border-top-style border-right-style
border-bottom-style border-left-style border-top-width border-right-width border-bottom-width border-left-width
border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
border-collapse border-spacing display float clear font font-family font-size font-style font-weight font-variant
height min-height max-height width min-width max-width letter-spacing line-height list-style list-style-type
margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left
opacity overflow table-layout text-align text-decoration text-indent text-transform vertical-align white-space
word-break word-wrap overflow-wrap direction visibility box-sizing outline
mso-line-height-rule mso-table-lspace mso-table-rspace mso-padding-alt mso-hide
-webkit-text-size-adjust -ms-text-size-adjust`
    .split(/\s+/)
    .filter(Boolean),
);
const MAX_VALUE = 400;
const BAD_VALUE =
  /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|[\\<>]|\/\*|\*\//i;
const URL_FN = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;
const SAFE_URL = /^https:\/\/[^\s"'()<>\\]{1,500}$/i;
const SAFE_SELECTOR = /^[\w\s.#>+~*:,[\]="'^$|()-]{1,300}$/;
const SAFE_IMPORT =
  /^@import\s+url\(\s*["']?https:\/\/fonts\.googleapis\.com\/[^"')\s]+["']?\s*\)\s*;?$/i;

function cleanValue(raw: string): string | null {
  let value = raw.trim().replace(/\s*!important\s*$/i, (m) => m.toLowerCase());
  if (!value || value.length > MAX_VALUE || BAD_VALUE.test(value)) return null;
  let ok = true;
  value = value.replace(URL_FN, (_whole, _q, url: string) => {
    if (!SAFE_URL.test(url.trim())) {
      ok = false;
      return "";
    }
    return `url("${url.trim()}")`;
  });
  return ok ? value : null;
}

function cleanDeclarations(block: string): string {
  const out: string[] = [];
  // Split on `;` outside parentheses and quotes (url(...) may contain one).
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of block) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0 && !quote) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const decl of parts) {
    const i = decl.indexOf(":");
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    if (!PROPS.has(prop)) continue;
    const value = cleanValue(decl.slice(i + 1));
    if (value) out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

/** Reads a `{ ... }` block starting at `start` (the index of `{`); returns [inner, indexAfter] or null if unbalanced. */
function readBlock(css: string, start: number): [string, number] | null {
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return [css.slice(start + 1, i), i + 1];
  }
  return null;
}

function clean(css: string, depth: number): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i]!)) i++;
    if (i >= css.length) break;
    if (css[i] === "@") {
      const brace = css.indexOf("{", i);
      const semi = css.indexOf(";", i);
      const isBlock = brace !== -1 && (semi === -1 || brace < semi);
      if (!isBlock) {
        const end = semi === -1 ? css.length : semi + 1;
        const stmt = css.slice(i, end).trim();
        if (SAFE_IMPORT.test(stmt)) out.push(stmt.endsWith(";") ? stmt : `${stmt};`);
        i = end;
        continue;
      }
      const prelude = css.slice(i, brace).trim();
      const block = readBlock(css, brace);
      if (!block) break;
      if (
        depth === 0 &&
        /^@media\s/i.test(prelude) &&
        /^[\w\s:(),.-]+$/.test(prelude.slice(6))
      ) {
        const inner = clean(block[0], depth + 1);
        if (inner) out.push(`${prelude}{${inner}}`);
      }
      i = block[1];
      continue;
    }
    const brace = css.indexOf("{", i);
    if (brace === -1) break;
    const selector = css.slice(i, brace).trim();
    const block = readBlock(css, brace);
    if (!block) break;
    i = block[1];
    if (!SAFE_SELECTOR.test(selector) || /expression|javascript/i.test(selector))
      continue;
    const decls = cleanDeclarations(block[0]);
    if (decls) out.push(`${selector}{${decls}}`);
  }
  return out.join("\n");
}

export function sanitizeRawCss(css: string): string {
  return clean(css.replace(/\/\*[\s\S]*?\*\//g, ""), 0);
}

/** Same property/value rules for an inline `style=""` attribute (returns the cleaned declarations). */
export function sanitizeInlineStyle(style: string): string {
  return cleanDeclarations(style.replace(/\/\*[\s\S]*?\*\//g, ""));
}
