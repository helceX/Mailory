/**
 * Sender-domain rules (pure, browser-safe). A campaign may only be sent "from" an address whose domain the
 * organization has proven it controls — and never from a mailbox provider's own domain, because DMARC
 * alignment (and Gmail/Yahoo bulk-sender rules) would fail for anyone but that provider.
 */

/** Mailbox providers whose domains can never be used as a bulk From domain. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.tr",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "yandex.com",
  "yandex.com.tr",
  "yandex.ru",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "hotmail.com.tr",
  "outlook.com.tr",
  "mynet.com",
  "e-posta.com.tr",
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Lowercases, trims, strips a trailing dot and a leading "www."; returns null if it cannot be a valid public hostname. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  if (d.length < 4 || d.length > 253) return null;
  const labels = d.split(".");
  if (labels.length < 2) return null; // "com", "localhost"
  if (!labels.every((l) => LABEL.test(l))) return null; // also rejects "exa mple.com", "a..b.com", unicode (use punycode)
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null; // bare IPv4 like 10.0.0.1
  if (labels[labels.length - 1]!.length < 2) return null;
  return d;
}

export function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return normalizeDomain(email.slice(at + 1));
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

/** True for the platform's own domain or any subdomain of it. */
export function isPlatformDomain(domain: string, platformHost: string): boolean {
  const apex = platformHost.toLowerCase().split(".").slice(-2).join(".");
  const d = domain.toLowerCase();
  return d === apex || d.endsWith(`.${apex}`);
}

/**
 * A verified domain covers itself and every subdomain (that is how domain identities work at SES), so
 * `news@mail.example.com` is covered by a verified `example.com`. The most specific covering domain wins.
 */
export function findCoveringDomain<T extends { domain: string }>(
  domains: readonly T[],
  emailDomain: string,
): T | null {
  const target = emailDomain.toLowerCase();
  let best: T | null = null;
  for (const d of domains) {
    const name = d.domain.toLowerCase();
    if (target === name || target.endsWith(`.${name}`)) {
      if (!best || name.length > best.domain.length) best = d;
    }
  }
  return best;
}
