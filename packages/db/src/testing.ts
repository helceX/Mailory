import { randomUUID } from "node:crypto";
import { slugify } from "@mailory/core";
import type { OrgRole } from "@mailory/core";
import { createOrganizationWithOwner, type Database } from "./index";
import { memberships, users } from "./schema/index";

/** Fixtures for integration tests. Unique per call, so tests never need table truncation. */
export async function createTestUser(
  db: Database,
  overrides: Partial<{ email: string; firstName: string; verified: boolean }> = {},
) {
  const [user] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `t-${randomUUID()}@example.com`,
      passwordHash: "scrypt$1024$8$1$00$00", // never verifies; tests that need login use the auth service
      firstName: overrides.firstName ?? "Test",
      lastName: "User",
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    })
    .returning();
  return user!;
}

export async function createTestOrg(
  db: Database,
  ownerId: string,
  name = `Org ${randomUUID().slice(0, 8)}`,
) {
  return createOrganizationWithOwner(db, {
    name,
    slug: slugify(name),
    userId: ownerId,
  });
}

export async function addTestMember(
  db: Database,
  organizationId: string,
  userId: string,
  role: OrgRole,
) {
  await db.insert(memberships).values({ organizationId, userId, role });
}

/** Two fully separate tenants — the standard fixture for cross-tenant (IDOR) tests. */
export async function createTwoTenants(db: Database) {
  const ownerA = await createTestUser(db);
  const ownerB = await createTestUser(db);
  const orgA = await createTestOrg(db, ownerA.id);
  const orgB = await createTestOrg(db, ownerB.id);
  return { ownerA, ownerB, orgA, orgB };
}
