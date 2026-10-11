/**
 * Turkish tax identifiers used on invoices (same rules as Mediaory/CiM).
 * A company has a 10-digit VKN (vergi kimlik numarası); a sole proprietor
 * may invoice with their 11-digit TCKN. Both carry check digits, so a typo
 * is caught before it ends up on a legal invoice. Pure functions, no I/O.
 */

/** 10-digit VKN. Algorithm: GİB's published check-digit scheme. */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const tmp = (digits[i]! + (9 - i)) % 10;
    let part = (tmp * 2 ** (9 - i)) % 9;
    if (tmp !== 0 && part === 0) part = 9;
    sum += part;
  }
  return (10 - (sum % 10)) % 10 === digits[9];
}

/** 11-digit TCKN: first digit non-zero, then two check digits. */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  const first10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return first10 % 10 === d[10];
}

export type TaxIdKind = "vkn" | "tckn";

/** Classifies a tax number by length and verifies its check digits; `null` if it is neither. */
export function classifyTaxId(value: string): TaxIdKind | null {
  if (isValidVkn(value)) return "vkn";
  if (isValidTckn(value)) return "tckn";
  return null;
}
