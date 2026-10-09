import {
  listDomainsDueForCheck,
  recordAudit,
  saveDomainCheck,
  touchDomainCheck,
  type Database,
  type SenderDomain,
} from "@mailory/db";
import {
  MockDnsResolver,
  MockDomainProvider,
  SystemDnsResolver,
  UnconfiguredSesProvider,
  nextDomainState,
  verifyDomain,
  type DnsResolver,
  type DomainCheckOutcome,
  type DomainProvider,
} from "@mailory/email";

export type DeliverabilityConfig = {
  DNS_RESOLVER: "system" | "mock";
  MOCK_DNS_FILE?: string;
  DOMAIN_PROVIDER: "mock" | "ses";
};
export const DEFAULT_MOCK_DNS_FILE = "/tmp/mailory-mock-dns.json";

export function createDnsResolver(
  config: Pick<DeliverabilityConfig, "DNS_RESOLVER" | "MOCK_DNS_FILE">,
): DnsResolver {
  return config.DNS_RESOLVER === "mock"
    ? new MockDnsResolver(
        { file: config.MOCK_DNS_FILE ?? DEFAULT_MOCK_DNS_FILE },
        { isFile: true },
      )
    : new SystemDnsResolver();
}

export function createDomainProvider(
  config: Pick<DeliverabilityConfig, "DOMAIN_PROVIDER">,
  resolver: DnsResolver,
): DomainProvider {
  return config.DOMAIN_PROVIDER === "ses"
    ? new UnconfiguredSesProvider()
    : new MockDomainProvider(resolver);
}

export type CheckDeps = {
  db: Database;
  resolver: DnsResolver;
  provider: DomainProvider;
  now?: () => Date;
};
export type CheckActor = {
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type CheckResult = {
  outcome: DomainCheckOutcome;
  status: "pending" | "verified" | "failed";
  becameVerified: boolean;
  becameFailed: boolean;
  /** Records are correct, but another workspace already holds this domain verified. */
  claimedElsewhere: boolean;
};

/**
 * The one place a domain is checked and its result stored, used by the "check now" button and by the worker sweep so
 * both apply identical rules (including: an inconclusive lookup never changes status).
 */
export async function checkAndPersistDomain(
  deps: CheckDeps,
  row: SenderDomain,
  actor: CheckActor = { userId: null },
): Promise<CheckResult> {
  const now = (deps.now ?? (() => new Date()))();
  const orgId = row.organizationId as Parameters<typeof saveDomainCheck>[1];
  const outcome = await verifyDomain({
    domain: row.domain,
    dkimTokens: row.dkimTokens,
    ownershipToken: row.ownershipToken,
    resolver: deps.resolver,
    provider: deps.provider,
  });

  const next = nextDomainState(
    {
      status: row.status as CheckResult["status"],
      createdAt: row.createdAt,
      failingSince: row.failingSince,
    },
    outcome,
    now,
  );

  if (outcome.inconclusive) {
    await touchDomainCheck(deps.db, orgId, row.id, now, "lookup_failed");
    return {
      outcome,
      status: next.status,
      becameVerified: false,
      becameFailed: false,
      claimedElsewhere: false,
    };
  }

  const saved = await saveDomainCheck(deps.db, orgId, row.id, {
    status: next.status,
    failingSince: next.failingSince,
    ownershipOk: outcome.ownershipOk,
    dkimOk: outcome.dkimOk,
    spfState: outcome.spfState,
    dmarcState: outcome.dmarcState,
    snapshot: outcome.results,
    checkedAt: now,
    ...(next.becameVerified ? { verifiedAt: now } : {}),
  });
  if (saved === "claimed_elsewhere")
    return {
      outcome,
      status: "pending",
      becameVerified: false,
      becameFailed: false,
      claimedElsewhere: true,
    };

  if (next.becameVerified || next.becameFailed) {
    await recordAudit(deps.db, {
      organizationId: orgId,
      userId: actor.userId,
      action: next.becameVerified ? "sender_domain.verified" : "sender_domain.failed",
      entityType: "sender_domain",
      entityId: row.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
      metadata: { domain: row.domain },
    });
  }
  return {
    outcome,
    status: next.status,
    becameVerified: next.becameVerified,
    becameFailed: next.becameFailed,
    claimedElsewhere: false,
  };
}

export type SweepSummary = {
  checked: number;
  verified: number;
  failed: number;
  inconclusive: number;
  errors: number;
};

/** Re-checks every domain whose interval has elapsed. One bad domain never stops the sweep. */
export async function sweepDomains(
  deps: CheckDeps,
  options: { limit?: number; organizationId?: string; concurrency?: number } = {},
): Promise<SweepSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await listDomainsDueForCheck(deps.db, now, options.limit ?? 50, {
    organizationId: options.organizationId,
  });
  const summary: SweepSummary = {
    checked: 0,
    verified: 0,
    failed: 0,
    inconclusive: 0,
    errors: 0,
  };

  // Small worker pool: DNS lookups are slow I/O, but never hammer resolvers with every domain at once.
  let next = 0;
  const run = async () => {
    for (let i = next++; i < due.length; i = next++) {
      const row = due[i]!;
      try {
        const result = await checkAndPersistDomain(deps, row);
        summary.checked++;
        if (result.becameVerified) summary.verified++;
        if (result.becameFailed) summary.failed++;
        if (result.outcome.inconclusive) summary.inconclusive++;
      } catch (error) {
        summary.errors++;
        console.error(`[deliverability] check failed for ${row.domain}`, error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 5, due.length) }, run),
  );
  return summary;
}
