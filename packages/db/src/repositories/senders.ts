import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { asOrganizationId } from "../index";
import {
  brandKits,
  contacts,
  senderDomains,
  senderIdentities,
  templates,
} from "../schema/index";

const isUnique = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string }; constraint?: string };
  return x?.code === "23505" || x?.cause?.code === "23505";
};
const constraintOf = (e: unknown) =>
  ((e as { constraint?: string })?.constraint ??
    (e as { cause?: { constraint?: string } })?.cause?.constraint ??
    "") as string;

// ---- domains -------------------------------------------------------------------------------------

export async function createSenderDomain(
  db: Database,
  organizationId: OrganizationId,
  input: {
    domain: string;
    provider: string;
    dkimTokens: string[];
    ownershipToken: string;
    userId: string | null;
  },
) {
  try {
    const [row] = await db
      .insert(senderDomains)
      .values({
        organizationId,
        domain: input.domain,
        provider: input.provider,
        dkimTokens: input.dkimTokens,
        ownershipToken: input.ownershipToken,
        createdByUserId: input.userId,
      })
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listSenderDomains(db: Database, organizationId: OrganizationId) {
  return db
    .select()
    .from(senderDomains)
    .where(eq(senderDomains.organizationId, organizationId))
    .orderBy(asc(senderDomains.domain));
}

export async function getSenderDomain(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(senderDomains)
    .where(
      and(eq(senderDomains.organizationId, organizationId), eq(senderDomains.id, id)),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteSenderDomain(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(senderDomains)
    .where(
      and(eq(senderDomains.organizationId, organizationId), eq(senderDomains.id, id)),
    )
    .returning({ domain: senderDomains.domain });
  return rows[0] ?? null;
}

export type DomainCheckRecord = {
  status: "pending" | "verified" | "failed";
  failingSince: Date | null;
  ownershipOk: boolean;
  dkimOk: boolean;
  spfState: string;
  dmarcState: string;
  snapshot: unknown;
  checkedAt: Date;
  /** Set when this check is what verified the domain. */
  verifiedAt?: Date;
};

/**
 * Persists a check. If it would make this organization the verified holder of a domain another workspace already
 * holds, the unique index refuses and the domain stays pending with an explanatory error instead of failing the check.
 */
export async function saveDomainCheck(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  check: DomainCheckRecord,
): Promise<"ok" | "not_found" | "claimed_elsewhere"> {
  const base = {
    ownershipOk: check.ownershipOk,
    dkimOk: check.dkimOk,
    spfState: check.spfState,
    dmarcState: check.dmarcState,
    lastCheck: check.snapshot,
    lastCheckedAt: check.checkedAt,
  };
  try {
    const rows = await db
      .update(senderDomains)
      .set({
        ...base,
        status: check.status,
        failingSince: check.failingSince,
        lastError: null,
        ...(check.verifiedAt ? { verifiedAt: check.verifiedAt } : {}),
      })
      .where(
        and(eq(senderDomains.organizationId, organizationId), eq(senderDomains.id, id)),
      )
      .returning({ id: senderDomains.id });
    return rows.length ? "ok" : "not_found";
  } catch (error) {
    if (isUnique(error) && constraintOf(error).includes("verified")) {
      await db
        .update(senderDomains)
        .set({
          ...base,
          status: "pending",
          failingSince: null,
          lastError: "claimed_elsewhere",
        })
        .where(
          and(
            eq(senderDomains.organizationId, organizationId),
            eq(senderDomains.id, id),
          ),
        );
      return "claimed_elsewhere";
    }
    throw error;
  }
}

/** Records that a check could not run (provider down etc.) without touching status. */
export async function touchDomainCheck(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  at: Date,
  error: string | null,
) {
  await db
    .update(senderDomains)
    .set({ lastCheckedAt: at, lastError: error })
    .where(
      and(eq(senderDomains.organizationId, organizationId), eq(senderDomains.id, id)),
    );
}

export const CHECK_INTERVALS_MS = {
  pending: 10 * 60_000,
  verifiedHealthy: 24 * 3_600_000,
  verifiedFailing: 15 * 60_000,
  failed: 6 * 3_600_000,
} as const;

/** Global by design (the worker sweeps every tenant); returns tenant-branded ids so callers write back scoped. */
export async function listDomainsDueForCheck(
  db: Database,
  now: Date,
  limit = 50,
  scope: { organizationId?: string } = {},
) {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const due = or(
    and(
      eq(senderDomains.status, "pending"),
      or(
        isNull(senderDomains.lastCheckedAt),
        lt(senderDomains.lastCheckedAt, ago(CHECK_INTERVALS_MS.pending)),
      ),
    ),
    and(
      eq(senderDomains.status, "verified"),
      isNull(senderDomains.failingSince),
      or(
        isNull(senderDomains.lastCheckedAt),
        lt(senderDomains.lastCheckedAt, ago(CHECK_INTERVALS_MS.verifiedHealthy)),
      ),
    ),
    and(
      eq(senderDomains.status, "verified"),
      isNotNull(senderDomains.failingSince),
      or(
        isNull(senderDomains.lastCheckedAt),
        lt(senderDomains.lastCheckedAt, ago(CHECK_INTERVALS_MS.verifiedFailing)),
      ),
    ),
    and(
      eq(senderDomains.status, "failed"),
      or(
        isNull(senderDomains.lastCheckedAt),
        lt(senderDomains.lastCheckedAt, ago(CHECK_INTERVALS_MS.failed)),
      ),
    ),
  );
  const rows = await db
    .select()
    .from(senderDomains)
    .where(
      scope.organizationId
        ? and(due, eq(senderDomains.organizationId, scope.organizationId))
        : due,
    )
    .orderBy(asc(sql`coalesce(${senderDomains.lastCheckedAt}, 'epoch'::timestamptz)`))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    organizationId: asOrganizationId(r.organizationId),
  }));
}

/** Global: how many organizations (any) still claim this domain. */
export async function countSenderDomainClaims(db: Database, domain: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(senderDomains)
    .where(eq(senderDomains.domain, domain.toLowerCase()));
  return row?.n ?? 0;
}

// ---- identities ----------------------------------------------------------------------------------

export async function createSenderIdentity(
  db: Database,
  organizationId: OrganizationId,
  input: {
    fromName: string;
    fromEmail: string;
    replyTo: string | null;
    userId: string | null;
  },
) {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: senderIdentities.id })
        .from(senderIdentities)
        .where(eq(senderIdentities.organizationId, organizationId))
        .limit(1);
      const [row] = await tx
        .insert(senderIdentities)
        .values({
          organizationId,
          fromName: input.fromName,
          fromEmail: input.fromEmail,
          replyTo: input.replyTo,
          createdByUserId: input.userId,
          isDefault: !existing,
        })
        .returning();
      return row ?? null;
    });
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listSenderIdentities(
  db: Database,
  organizationId: OrganizationId,
) {
  return db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.organizationId, organizationId))
    .orderBy(desc(senderIdentities.isDefault), asc(senderIdentities.fromEmail));
}

export async function getSenderIdentity(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(senderIdentities)
    .where(
      and(
        eq(senderIdentities.organizationId, organizationId),
        eq(senderIdentities.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateSenderIdentity(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  input: { fromName: string; fromEmail: string; replyTo: string | null },
) {
  try {
    const [row] = await db
      .update(senderIdentities)
      .set({
        fromName: input.fromName,
        fromEmail: input.fromEmail,
        replyTo: input.replyTo,
      })
      .where(
        and(
          eq(senderIdentities.organizationId, organizationId),
          eq(senderIdentities.id, id),
        ),
      )
      .returning();
    return row ?? ("not_found" as const);
  } catch (error) {
    if (isUnique(error)) return "duplicate" as const;
    throw error;
  }
}

/** Atomically moves the default flag so there is never zero or two defaults. */
export async function setDefaultSenderIdentity(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(
        and(
          eq(senderIdentities.organizationId, organizationId),
          eq(senderIdentities.id, id),
        ),
      )
      .for("update");
    if (!target) return false;
    await tx
      .update(senderIdentities)
      .set({ isDefault: false })
      .where(
        and(
          eq(senderIdentities.organizationId, organizationId),
          eq(senderIdentities.isDefault, true),
        ),
      );
    await tx
      .update(senderIdentities)
      .set({ isDefault: true })
      .where(
        and(
          eq(senderIdentities.organizationId, organizationId),
          eq(senderIdentities.id, id),
        ),
      );
    return true;
  });
}

/** Deleting the default promotes the oldest remaining identity so the organization always has one. */
export async function deleteSenderIdentity(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(senderIdentities)
      .where(
        and(
          eq(senderIdentities.organizationId, organizationId),
          eq(senderIdentities.id, id),
        ),
      )
      .returning({ isDefault: senderIdentities.isDefault });
    if (!gone) return false;
    if (gone.isDefault) {
      const [next] = await tx
        .select({ id: senderIdentities.id })
        .from(senderIdentities)
        .where(eq(senderIdentities.organizationId, organizationId))
        .orderBy(asc(senderIdentities.createdAt))
        .limit(1);
      if (next)
        await tx
          .update(senderIdentities)
          .set({ isDefault: true })
          .where(eq(senderIdentities.id, next.id));
    }
    return true;
  });
}

// ---- onboarding ----------------------------------------------------------------------------------

/** One round trip: the facts the onboarding checklist is derived from (never stored, so never stale). */
export async function getOnboardingFacts(db: Database, organizationId: OrganizationId) {
  const result = await db.execute<{
    logo: boolean;
    brand: boolean;
    identity: boolean;
    domain_verified: boolean;
    contacts: boolean;
    template: boolean;
  }>(sql`
    select
      exists (select 1 from ${brandKits} where organization_id = ${organizationId}::uuid and logo_asset_id is not null) as logo,
      exists (select 1 from ${brandKits} where organization_id = ${organizationId}::uuid) as brand,
      exists (select 1 from ${senderIdentities} where organization_id = ${organizationId}::uuid) as identity,
      exists (select 1 from ${senderDomains} where organization_id = ${organizationId}::uuid and status = 'verified') as domain_verified,
      exists (select 1 from ${contacts} where organization_id = ${organizationId}::uuid) as contacts,
      exists (select 1 from ${templates} where organization_id = ${organizationId}::uuid and archived_at is null) as template`);
  const row = result.rows[0]!;
  return {
    logo: row.logo,
    brandKit: row.brand,
    senderIdentity: row.identity,
    domainVerified: row.domain_verified,
    contacts: row.contacts,
    template: row.template,
  };
}
