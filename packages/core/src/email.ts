/** Pragmatic address check for bulk data: one @, dotted domain, no spaces, sane length. Deliverability is verified by sending, not by regex. */
const EMAIL_RE = /^[^\s@"<>(),;:]+@[^\s@"<>(),;:]+\.[^\s@"<>(),;:]{2,}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value) && !value.includes("..");
}
