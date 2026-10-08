/*
 * Turkish text helpers for personalization. Personalized mail in Turkish breaks the moment a name takes a suffix:
 * "{{first_name}}'e" renders "Ayşe'e". The filters here attach the right case suffix by vowel harmony, so a template
 * can say {{first_name:e}} and get Ayşe'ye / Ali'ye / Ahmet'e / Can'a. Pure and browser-safe.
 */

const VOWELS = "aeıioöuü";
const BACK = "aıou";
const ROUNDED = "ouöü";
const VOICELESS = "çfhkpsşt";
/** Names ending in "al/il"-type words where the final l is soft, so the suffix harmonizes as if front-vowelled. */
const SOFT_L = new Set([
  "kemal",
  "hilal",
  "nihal",
  "cemal",
  "zuhal",
  "ikbal",
  "iqbal",
  "gıyasettin",
]);

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/** "AYŞE" / "ayşe" → "Ayşe"; every word (and hyphenated part) is capitalized with Turkish i/ı rules. */
export function trTitleCase(value: string): string {
  return lower(value)
    .split(/(\s+|-)/)
    .map((part) =>
      /^\s+$|^-$/.test(part) || part === ""
        ? part
        : part.charAt(0).toLocaleUpperCase("tr-TR") + part.slice(1),
    )
    .join("");
}

export type TrSuffix = "e" | "i" | "in" | "de" | "den";
export const TR_SUFFIX_LABELS: Record<TrSuffix, string> = {
  e: "yönelme (Ayşe'ye)",
  i: "belirtme (Ayşe'yi)",
  in: "tamlayan (Ayşe'nin)",
  de: "bulunma (Ayşe'de)",
  den: "ayrılma (Ayşe'den)",
};

function lastVowel(word: string): string | null {
  for (let i = word.length - 1; i >= 0; i--)
    if (VOWELS.includes(word[i]!)) return word[i]!;
  return null;
}

/** Attaches a case suffix to a name with an apostrophe and correct harmony ("Ayşe" + e → "Ayşe'ye"). */
export function trSuffix(name: string, suffix: TrSuffix): string {
  const text = name.trim();
  if (!text || !/\p{L}/u.test(text) || /\d/.test(text)) return text;
  const lastWord = lower(text.split(/[\s-]+/).pop() ?? text).replace(/[^\p{L}]/gu, "");
  const v = lastVowel(lastWord);
  if (!v) return text;
  const endsVowel = VOWELS.includes(lastWord[lastWord.length - 1]!);
  const back = SOFT_L.has(lastWord) ? false : BACK.includes(v);
  const rounded = ROUNDED.includes(v);
  const two = back ? "a" : "e";
  const four = back ? (rounded ? "u" : "ı") : rounded ? "ü" : "i";
  const voiceless = VOICELESS.includes(lastWord[lastWord.length - 1]!);
  const tail = {
    e: `${endsVowel ? "y" : ""}${two}`,
    i: `${endsVowel ? "y" : ""}${four}`,
    in: endsVowel ? `n${four}n` : `${four}n`,
    de: `${voiceless ? "t" : "d"}${two}`,
    den: `${voiceless ? "t" : "d"}${two}n`,
  }[suffix];
  // Use the typographic-neutral ASCII apostrophe: it survives every mail client and plain-text part.
  return `${text}'${tail}`;
}

export const MERGE_FILTERS = [
  "title",
  "upper",
  "lower",
  "e",
  "i",
  "in",
  "de",
  "den",
] as const;
export type MergeFilter = (typeof MERGE_FILTERS)[number];

/** Applies a named merge filter; unknown names leave the value untouched (never break a send over a typo). */
export function applyMergeFilter(value: string, filter: string | undefined): string {
  if (!filter) return value;
  switch (filter.toLowerCase()) {
    case "title":
      return trTitleCase(value);
    case "upper":
      return value.toLocaleUpperCase("tr-TR");
    case "lower":
      return lower(value);
    case "e":
    case "i":
    case "in":
    case "de":
    case "den":
      return trSuffix(trTitleCase(value), filter.toLowerCase() as TrSuffix);
    default:
      return value;
  }
}
