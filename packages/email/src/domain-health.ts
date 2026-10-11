import {
  COMMON_DKIM_SELECTORS,
  analyzeDomainHealth,
  type DomainHealth,
} from "@mailory/core/shared";
import type { DnsResolver } from "./dns";

/**
 * Looks up everything the free domain-health analysis needs and runs it. Lookups run in parallel and a failed one is
 * recorded (not treated as "record missing"), so a flaky resolver can never produce a false "you have no SPF".
 */
export async function checkDomainHealth(
  resolver: DnsResolver,
  domain: string,
): Promise<DomainHealth> {
  const failures: string[] = [];
  const attempt = async <T>(key: string, fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch {
      failures.push(key);
      return fallback;
    }
  };
  const [txt, dmarc, mx, dkim] = await Promise.all([
    attempt(domain, () => resolver.txt(domain), [] as string[]),
    attempt(`_dmarc.${domain}`, () => resolver.txt(`_dmarc.${domain}`), [] as string[]),
    attempt(`mx:${domain}`, () => resolver.mx(domain), [] as string[]),
    Promise.all(
      COMMON_DKIM_SELECTORS.map(async (selector): Promise<string | null> => {
        const name = `${selector}._domainkey.${domain}`;
        // A selector counts when a DKIM TXT record or a CNAME (hosted keys, e.g. SES/Microsoft) exists.
        const [t, c] = await Promise.all([
          resolver.txt(name).catch(() => [] as string[]),
          resolver.cname(name).catch(() => [] as string[]),
        ]);
        return t.some((r) => /v=DKIM1|p=/i.test(r)) || c.length > 0 ? selector : null;
      }),
    ),
  ]);
  return analyzeDomainHealth({
    domain,
    txt,
    dmarc,
    mx,
    dkimSelectors: dkim.filter((s): s is string => s !== null),
    lookupFailures: failures,
  });
}
