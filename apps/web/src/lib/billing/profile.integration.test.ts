import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { billingProfileSchema, type BillingProfileValues } from "@mailory/validation";
import { asOrganizationId, auditLogs, createDb, type Database } from "@mailory/db";
import { addTestMember, createTestOrg, createTestUser } from "@mailory/db/testing";
import type { OrgRole } from "@mailory/core";
import type { Actor } from "../org/service";
import { getBillingProfileFor, saveBillingProfileFor } from "./profile";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const valid = (over: Partial<Record<string, string>> = {}) =>
  billingProfileSchema.parse({
    legalName: "Acme A.Ş.",
    taxOffice: "Kadıköy",
    taxId: "1234567890",
    addressLine: "Moda Cd. 1",
    city: "İstanbul",
    invoiceEmail: "Fatura@Acme.com",
    ...over,
  });

describe("billing profile validation", () => {
  it("accepts a valid VKN and normalizes the e-mail", () => {
    const v: BillingProfileValues = valid();
    expect(v.invoiceEmail).toBe("fatura@acme.com");
    expect(v.country).toBe("TR");
  });
  it("rejects a mistyped tax number, wrong length and missing fields", () => {
    expect(
      billingProfileSchema.safeParse({ ...valid(), taxId: "1234567891" }).success,
    ).toBe(false);
    expect(billingProfileSchema.safeParse({ ...valid(), taxId: "123" }).success).toBe(
      false,
    );
    expect(billingProfileSchema.safeParse({ ...valid(), legalName: " " }).success).toBe(
      false,
    );
    expect(billingProfileSchema.safeParse({ ...valid(), country: "DE" }).success).toBe(
      false,
    );
  });
});

suite("billing profile service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function actorFor(role: OrgRole, orgId?: string) {
    const owner = await createTestUser(db);
    const org = orgId ? { id: orgId } : await createTestOrg(db, owner.id);
    if (role === "owner" && !orgId)
      return { org, actor: mk(owner.id, org.id, "owner") };
    const u = await createTestUser(db);
    await addTestMember(db, org.id, u.id, role);
    return { org, actor: mk(u.id, org.id, role) };
  }
  const mk = (userId: string, org: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(org),
    role,
  });

  it("only the owner can read or write invoice details", async () => {
    const { org, actor: owner } = await actorFor("owner");
    for (const role of ["admin", "editor", "viewer"] as const) {
      const { actor } = await actorFor(role, org.id);
      expect(await getBillingProfileFor({ db }, actor)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(await saveBillingProfileFor({ db }, actor, valid())).toMatchObject({
        ok: false,
        code: "forbidden",
      });
    }
    expect((await saveBillingProfileFor({ db }, owner, valid())).ok).toBe(true);
  });

  it("upserts one profile per organization, classifies the tax number and keeps tenants apart", async () => {
    const a = await actorFor("owner");
    const b = await actorFor("owner");
    await saveBillingProfileFor({ db }, a.actor, valid());
    await saveBillingProfileFor(
      { db },
      a.actor,
      valid({ legalName: "Acme Yeni A.Ş." }),
    );
    const r = await getBillingProfileFor({ db }, a.actor);
    expect(r.ok && r.profile).toMatchObject({
      legalName: "Acme Yeni A.Ş.",
      taxIdKind: "vkn",
    });
    const other = await getBillingProfileFor({ db }, b.actor);
    expect(other.ok && other.profile).toBeNull();
    const tckn = await saveBillingProfileFor(
      { db },
      b.actor,
      valid({ taxId: "10000000146" }),
    );
    expect(tckn.ok && tckn.profile.taxIdKind).toBe("tckn");
  });

  it("audits the change without writing the tax number", async () => {
    const { org, actor } = await actorFor("owner");
    await saveBillingProfileFor({ db }, actor, valid());
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, org.id));
    const row = rows.find((x) => x.action === "billing_profile.updated");
    expect(row).toBeTruthy();
    expect(JSON.stringify(row!.metadata)).not.toContain("1234567890");
  });
});
