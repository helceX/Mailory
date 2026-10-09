import { buildDnsRecords, checkDns, type DnsResolver, type RecordResult } from "./dns";
import type { DomainProvider, ProviderDkimStatus } from "./provider";

export type DomainStatus = "pending" | "verified" | "failed";

export type DomainCheckOutcome = {
  results: RecordResult[];
  ownershipOk: boolean;
  dkimOk: boolean;
  spfState: RecordResult["state"];
  dmarcState: RecordResult["state"];
  providerDkim: ProviderDkimStatus | "error";
  /** A lookup failed, so nothing can be concluded: callers must not change the stored status. */
  inconclusive: boolean;
  /** Required records present AND the provider confirms DKIM. */
  verified: boolean;
};

export async function verifyDomain(input: {
  domain: string;
  dkimTokens: string[];
  ownershipToken: string;
  resolver: DnsResolver;
  provider: DomainProvider;
}): Promise<DomainCheckOutcome> {
  const records = buildDnsRecords(input);
  const results = await checkDns(input.resolver, records);
  const byKey = new Map(results.map((r) => [r.key, r]));

  let providerDkim: DomainCheckOutcome["providerDkim"];
  try {
    providerDkim = (
      await input.provider.getIdentityStatus(input.domain, {
        dkimTokens: input.dkimTokens,
      })
    ).dkim;
  } catch {
    providerDkim = "error";
  }

  const required = results.filter((r) => r.required);
  const ownershipOk = byKey.get("ownership")?.state === "ok";
  const dkimOk = (["dkim1", "dkim2", "dkim3"] as const).every(
    (k) => byKey.get(k)?.state === "ok",
  );
  // Only the REQUIRED records and the provider can make a result inconclusive; a flaky optional lookup (SPF/DMARC) cannot.
  const inconclusive =
    required.some((r) => r.state === "error") || providerDkim === "error";

  return {
    results,
    ownershipOk,
    dkimOk,
    spfState: byKey.get("spf")?.state ?? "missing",
    dmarcState: byKey.get("dmarc")?.state ?? "missing",
    providerDkim,
    inconclusive,
    verified: !inconclusive && ownershipOk && dkimOk && providerDkim === "success",
  };
}

export const PENDING_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
export const FAILING_GRACE_MS = 60 * 60 * 1000;

export type StoredDomainState = {
  status: DomainStatus;
  createdAt: Date;
  failingSince: Date | null;
};
export type NextDomainState = {
  status: DomainStatus;
  failingSince: Date | null;
  becameVerified: boolean;
  becameFailed: boolean;
};

/**
 * Status transitions (pure, so they are tested with a fake clock):
 *  - an inconclusive check changes nothing;
 *  - success verifies and clears any failing marker;
 *  - a verified domain that starts failing is NOT revoked immediately: it must still fail an hour later, so a DNS
 *    hiccup or a registrar edit in progress cannot pause someone's sending;
 *  - a never-verified domain times out to "failed" after 7 days (a prompt to re-check the records).
 */
export function nextDomainState(
  current: StoredDomainState,
  outcome: Pick<DomainCheckOutcome, "verified" | "inconclusive">,
  now: Date,
): NextDomainState {
  const keep = (status: DomainStatus, failingSince: Date | null): NextDomainState => ({
    status,
    failingSince,
    becameVerified: false,
    becameFailed: false,
  });
  if (outcome.inconclusive) return keep(current.status, current.failingSince);
  if (outcome.verified)
    return {
      status: "verified",
      failingSince: null,
      becameVerified: current.status !== "verified",
      becameFailed: false,
    };

  if (current.status === "verified") {
    if (!current.failingSince) return keep("verified", now);
    if (now.getTime() - current.failingSince.getTime() >= FAILING_GRACE_MS)
      return {
        status: "failed",
        failingSince: current.failingSince,
        becameVerified: false,
        becameFailed: true,
      };
    return keep("verified", current.failingSince);
  }
  if (
    current.status === "pending" &&
    now.getTime() - current.createdAt.getTime() > PENDING_TIMEOUT_MS
  ) {
    return {
      status: "failed",
      failingSince: null,
      becameVerified: false,
      becameFailed: true,
    };
  }
  return keep(current.status, current.failingSince);
}
