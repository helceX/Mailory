import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { OrgRole } from "@mailory/core";
import type { Database, OrganizationId } from "../index";
import { asOrganizationId } from "../index";
import {
  invitations,
  memberships,
  organizations,
  sessions,
  users,
} from "../schema/index";

/*
 * Tenancy convention (ADR-001, docs/MAILORY_ARCHITECTURE.md §3): every tenant-scoped function takes
 * `organizationId: OrganizationId` as its first argument after `db` — there is no unscoped variant.
 * The few functions below that are intentionally global (identity/credential lookups) are listed in
 * GLOBAL_REPOSITORY_FUNCTIONS and guarded by tenancy.convention.test.ts.
 */

const UNIQUE_VIOLATION = "23505";
const isUnique = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === UNIQUE_VIOLATION || x?.cause?.code === UNIQUE_VIOLATION;
};

// ---- global (user- or credential-scoped) --------------------------------------------------------

/** Creates the org and its first owner atomically. Retries with a suffixed slug on collision. */
export async function createOrganizationWithOwner(
  db: Database,
  input: {
    name: string;
    slug: string;
    userId: string;
    type?: "standard" | "partner";
    parentOrganizationId?: string | null;
  },
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug =
      attempt === 0
        ? input.slug
        : `${input.slug}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({
            name: input.name,
            slug,
            type: input.type ?? "standard",
            parentOrganizationId: input.parentOrganizationId ?? null,
          })
          .returning();
        await tx
          .insert(memberships)
          .values({ organizationId: org!.id, userId: input.userId, role: "owner" });
        return org!;
      });
    } catch (error) {
      if (!isUnique(error)) throw error;
    }
  }
  throw new Error("Could not allocate a unique organization slug");
}

/** Orgs a user actively belongs to (soft-deleted orgs excluded). */
export async function listUserMemberships(db: Database, userId: string) {
  const rows = await db
    .select({
      organizationId: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      type: organizations.type,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({
    ...r,
    organizationId: asOrganizationId(r.organizationId),
    role: r.role as OrgRole,
  }));
}

/** The credential (token hash) is the authority here, not a tenant id. */
export async function findInvitationByTokenHash(db: Database, tokenHash: string) {
  const [row] = await db
    .select({ invitation: invitations, organizationName: organizations.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(and(eq(invitations.tokenHash, tokenHash), isNull(organizations.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Atomically consumes a pending invitation and creates the membership. Returns null if the
 * invitation was already used, revoked or expired.
 */
export async function acceptInvitation(
  db: Database,
  input: { invitationId: string; userId: string; now: Date },
) {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .update(invitations)
      .set({ acceptedAt: input.now })
      .where(
        and(
          eq(invitations.id, input.invitationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, input.now),
        ),
      )
      .returning();
    if (!invitation) return null;
    const [existing] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, invitation.organizationId),
          eq(memberships.userId, input.userId),
        ),
      )
      .limit(1);
    if (existing?.status === "active") {
      return {
        organizationId: asOrganizationId(invitation.organizationId),
        role: existing.role as OrgRole,
        alreadyMember: true,
      };
    }
    await tx
      .insert(memberships)
      .values({
        organizationId: invitation.organizationId,
        userId: input.userId,
        role: invitation.role,
        invitedByUserId: invitation.invitedByUserId,
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: { role: invitation.role, status: "active", updatedAt: input.now },
      });
    return {
      organizationId: asOrganizationId(invitation.organizationId),
      role: invitation.role as OrgRole,
      alreadyMember: false,
    };
  });
}

/** Persists the session's active org only if the user is an active member of it. */
export async function setActiveOrganization(
  db: Database,
  input: { sessionId: string; userId: string; organizationId: OrganizationId },
) {
  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.userId),
        eq(memberships.status, "active"),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  if (!member) return false;
  await db
    .update(sessions)
    .set({ activeOrganizationId: input.organizationId })
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)));
  return true;
}

// ---- tenant-scoped ------------------------------------------------------------------------------

export async function getOrganization(db: Database, organizationId: OrganizationId) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
    .limit(1);
  return org ?? null;
}

export async function getMember(
  db: Database,
  organizationId: OrganizationId,
  userId: string,
) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  return row ? { ...row, role: row.role as OrgRole } : null;
}

export async function listMembers(db: Database, organizationId: OrganizationId) {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as OrgRole }));
}

export type MemberChange = "ok" | "not_found" | "last_owner";

/**
 * Role change / removal lock the org's owner rows so two concurrent demotions cannot leave
 * the organization without an owner.
 */
async function guardedMemberChange(
  db: Database,
  organizationId: OrganizationId,
  userId: string,
  apply: (
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    current: { role: string },
  ) => Promise<void>,
  staysOwner: boolean,
): Promise<MemberChange> {
  return db.transaction(async (tx) => {
    const owners = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
        ),
      )
      .for("update");
    const [current] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!current) return "not_found";
    if (current.role === "owner" && !staysOwner && owners.length <= 1)
      return "last_owner";
    await apply(tx, current);
    return "ok";
  });
}

export async function updateMemberRole(
  db: Database,
  organizationId: OrganizationId,
  userId: string,
  role: OrgRole,
): Promise<MemberChange> {
  return guardedMemberChange(
    db,
    organizationId,
    userId,
    async (tx) => {
      await tx
        .update(memberships)
        .set({ role, updatedAt: new Date() })
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
          ),
        );
    },
    role === "owner",
  );
}

export async function removeMember(
  db: Database,
  organizationId: OrganizationId,
  userId: string,
): Promise<MemberChange> {
  return guardedMemberChange(
    db,
    organizationId,
    userId,
    async (tx) => {
      await tx
        .update(memberships)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
          ),
        );
      // A removed member must not keep this org active in any session.
      await tx
        .update(sessions)
        .set({ activeOrganizationId: null })
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.activeOrganizationId, organizationId),
          ),
        );
    },
    false,
  );
}

/** Replaces any pending invitation for the same email so only the newest link works. */
export async function createInvitation(
  db: Database,
  organizationId: OrganizationId,
  input: {
    email: string;
    // 'owner' is only reachable through the partner flow (a service-level rule); normal invites exclude it.
    role: OrgRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  },
) {
  return db.transaction(async (tx) => {
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          sql`lower(${invitations.email}) = ${input.email.toLowerCase()}`,
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(invitations)
      .values({
        organizationId,
        email: input.email.toLowerCase(),
        role: input.role,
        tokenHash: input.tokenHash,
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
      })
      .returning();
    return row!;
  });
}

export async function listPendingInvitations(
  db: Database,
  organizationId: OrganizationId,
  now = new Date(),
) {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

export async function revokeInvitation(
  db: Database,
  organizationId: OrganizationId,
  invitationId: string,
) {
  const rows = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, invitationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  return rows.length > 0;
}
