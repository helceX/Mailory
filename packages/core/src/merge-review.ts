import { MERGE_TOKEN } from "./email-doc";
import type { MergeValues } from "./email-markup";

const NAME_KEYS = new Set(["first_name", "last_name", "full_name", "company"]);
const SYSTEM_KEYS = new Set([
  "unsubscribe_url",
  "view_in_browser_url",
  "org_name",
  "current_year",
]);

export type MergeIssueCode =
  | "empty_value"
  | "all_caps"
  | "odd_name"
  | "long_subject"
  | "stray_punctuation";
export type MergeIssue = { code: MergeIssueCode; key?: string; message: string };

const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
const letters = (s: string) => s.replace(/[^\p{L}]/gu, "");

/**
 * "Pre-mortem" for one recipient: what would THIS person's email look like? Catches the mistakes that only appear with
 * real data — an empty name that leaves "Merhaba ,", a name typed in CAPS, a first name that is actually an e-mail
 * address or a number — before the campaign goes to everyone. Pure; the caller supplies the template texts.
 */
export function reviewMergeFor(
  texts: string[],
  values: MergeValues,
  rendered: { subject: string; text: string },
): MergeIssue[] {
  const out: MergeIssue[] = [];
  const seen = new Set<string>();
  const add = (i: MergeIssue) => {
    const k = `${i.code}:${i.key ?? ""}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(i);
    }
  };
  for (const text of texts)
    for (const m of text.matchAll(MERGE_TOKEN)) {
      const key = m[1]!.toLowerCase();
      const filter = m[2]?.toLowerCase();
      const hasFallback = m[3] !== undefined;
      const value = values[key];
      if (SYSTEM_KEYS.has(key)) continue;
      if (!filled(value)) {
        if (!hasFallback)
          add({
            code: "empty_value",
            key,
            message: `“${key}” bu kişide boş ve yedek metin yok; boş kalır. {{${key}|yedek metin}} kullanın.`,
          });
        continue;
      }
      const v = String(value);
      if (NAME_KEYS.has(key)) {
        const l = letters(v);
        if (
          l.length >= 2 &&
          l === l.toLocaleUpperCase("tr-TR") &&
          filter !== "title" &&
          filter !== "upper" &&
          !filter?.match(/^(e|i|in|de|den)$/)
        )
          add({
            code: "all_caps",
            key,
            message: `“${v}” büyük harfle kayıtlı; {{${key}:title}} ile düzgün yazılır.`,
          });
        if (key !== "company" && (/\d|@/.test(v) || l.length < 2))
          add({
            code: "odd_name",
            key,
            message: `“${v.slice(0, 40)}” bir ad gibi görünmüyor; kişinin verisini kontrol edin ya da yedek metin kullanın.`,
          });
      }
    }
  if (rendered.subject.length > 80)
    add({
      code: "long_subject",
      message: `Bu kişide konu ${rendered.subject.length} karakter oluyor; mobilde kesilir.`,
    });
  if (/(^|\s)[,!.:;]/.test(rendered.subject) || /(^|\n)\s*[,!.:;]/.test(rendered.text))
    add({
      code: "stray_punctuation",
      message:
        "Metinde boşlukla başlayan bir noktalama işareti var (örn. “Merhaba ,”); boş kalan bir alan olabilir.",
    });
  return out;
}
