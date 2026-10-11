import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MockAiProvider } from "@mailory/ai";
import {
  asOrganizationId,
  campaigns,
  checkEntitlement,
  clearOverride,
  createDb,
  createSenderDomain,
  createSenderIdentity,
  entitlementsOverview,
  getEffectiveLimits,
  organizations,
  plans,
  senderDomains,
  setOverride,
  setSubscription,
  type Database,
} from "@mailory/db";
import { addTestMember, createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_UTM, type OrgRole, type PlanKey } from "@mailory/core";
import { createContactFor, runImport } from "../audience/service";
import { setAiEnabledFor, suggestSubjectsFor } from "../ai/service";
import {
  activateAutomationFor,
  createAutomationFor,
  updateAutomationFor,
  archiveAutomationFor,
} from "../automations/service";
import {
  scheduleCampaignFor,
  createCampaignFor,
  updateCampaignFor,
} from "../campaigns/service";
import {
  inviteMember,
  revokeInvitation,
  listOrgAudit,
  type Actor,
} from "../org/service";
import { createTemplateFor, uploadAsset } from "../templates/service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const APP = "https://app.test";

// 1×1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

suite("plan limits are enforced where they matter (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  const actorFor = (userId: string, orgId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(orgId),
    role,
  });
  async function tenant(plan: PlanKey = "enterprise") {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id, undefined, { plan });
    return {
      user,
      org,
      oid: asOrganizationId(org.id),
      actor: actorFor(user.id, org.id, "owner"),
    };
  }
  const limit = (
    t: Awaited<ReturnType<typeof tenant>>,
    key: Parameters<typeof setOverride>[2]["key"],
    v: number | null,
  ) =>
    setOverride(db, t.oid, {
      key,
      limit: v,
      reason: "test",
      userId: null,
      byOrganizationId: null,
    });
  const orgDeps = () => ({ db, appUrl: APP, sendEmail: async () => {} });
  const contact = (email: string) => ({ email, consentStatus: "granted" as const });

  describe("effective limits", () => {
    it("an organization with no subscription is on the free plan", async () => {
      const t = await tenant();
      await db.execute(
        (await import("drizzle-orm"))
          .sql`delete from subscriptions where organization_id = ${t.org.id}::uuid`,
      );
      const o = await entitlementsOverview(db, t.oid);
      expect(o.planKey).toBe("free");
      expect(o.rows.find((r) => r.key === "contacts")!.limit).toBe(500);
    });
    it("override beats plan; an override of NULL means unlimited; clearing it restores the plan", async () => {
      const t = await tenant("free");
      expect((await getEffectiveLimits(db, t.oid)).contacts).toBe(500);
      await limit(t, "contacts", 5);
      expect((await getEffectiveLimits(db, t.oid)).contacts).toBe(5);
      await limit(t, "contacts", null);
      expect((await getEffectiveLimits(db, t.oid)).contacts).toBeNull();
      await clearOverride(db, t.oid, "contacts");
      expect((await getEffectiveLimits(db, t.oid)).contacts).toBe(500);
    });
    it("a plan with no row for a key fails closed (0), and a paused subscription falls back to free", async () => {
      const t = await tenant("free");
      await db
        .insert(plans)
        .values({ key: `empty${randomUUID().slice(0, 6)}`, name: "x" })
        .onConflictDoNothing();
      const [p] = await db.select().from(plans).where(eq(plans.name, "x")).limit(1);
      await setSubscription(db, t.oid, {
        planKey: p!.key as PlanKey,
        source: "manual",
        userId: null,
      });
      expect((await getEffectiveLimits(db, t.oid)).contacts).toBe(0);
      await setSubscription(db, t.oid, {
        planKey: "enterprise",
        source: "manual",
        status: "paused",
        userId: null,
      });
      expect((await getEffectiveLimits(db, t.oid)).contacts).toBe(500);
    });
    it("overrides and usage never leak across tenants", async () => {
      const a = await tenant("free");
      const b = await tenant("free");
      await limit(a, "contacts", 7);
      expect((await getEffectiveLimits(db, b.oid)).contacts).toBe(500);
    });
  });

  describe("contacts", () => {
    it("blocks creating contacts at the limit, and a limit raise unblocks it", async () => {
      const t = await tenant();
      await limit(t, "contacts", 2);
      expect(
        (await createContactFor({ db }, t.actor, contact("a1@example.org"))).ok,
      ).toBe(true);
      expect(
        (await createContactFor({ db }, t.actor, contact("a2@example.org"))).ok,
      ).toBe(true);
      const r = await createContactFor({ db }, t.actor, contact("a3@example.org"));
      expect(r).toMatchObject({ ok: false, code: "plan_limit" });
      expect((r as { message: string }).message).toContain("2 / 2");
      await limit(t, "contacts", 3);
      expect(
        (await createContactFor({ db }, t.actor, contact("a3@example.org"))).ok,
      ).toBe(true);
    });
    it("imports count only NEW contacts: re-importing existing addresses is fine, too many new ones is refused whole", async () => {
      const t = await tenant();
      await limit(t, "contacts", 3);
      for (const e of ["x1@example.org", "x2@example.org"])
        await createContactFor({ db }, t.actor, contact(e));
      const run = (csv: string) =>
        runImport({ db }, t.actor, {
          csv,
          mapping: { E: "email" },
          consentAttested: true,
          updateExisting: true,
          listId: null,
          tagIds: [],
        } as never);
      // 2 existing + 1 new = fits exactly
      expect((await run("E\nx1@example.org\nx2@example.org\nx3@example.org")).ok).toBe(
        true,
      );
      // now full: 1 existing + 1 new → refused, nothing imported
      const refused = await run("E\nx1@example.org\nx4@example.org");
      expect(refused).toMatchObject({ ok: false, code: "plan_limit" });
      expect((await checkEntitlement(db, t.oid, "contacts", 0)).used).toBe(3);
      // all existing → fine even though full
      expect((await run("E\nx1@example.org")).ok).toBe(true);
    });
    it("a downgrade below current usage deletes nothing but blocks growth", async () => {
      const t = await tenant();
      for (const e of ["d1@example.org", "d2@example.org", "d3@example.org"])
        await createContactFor({ db }, t.actor, contact(e));
      await limit(t, "contacts", 1);
      expect((await checkEntitlement(db, t.oid, "contacts", 0)).used).toBe(3);
      expect(
        await createContactFor({ db }, t.actor, contact("d4@example.org")),
      ).toMatchObject({ code: "plan_limit" });
    });
  });

  describe("members", () => {
    it("invitations count against the member limit; revoking frees a seat", async () => {
      const t = await tenant("free"); // 2 members; the owner is one
      const first = await inviteMember(orgDeps(), t.actor, {
        email: `m1-${randomUUID().slice(0, 5)}@example.org`,
        role: "editor",
      });
      expect(first.ok).toBe(true);
      const second = await inviteMember(orgDeps(), t.actor, {
        email: `m2-${randomUUID().slice(0, 5)}@example.org`,
        role: "editor",
      });
      expect(second).toMatchObject({ ok: false, code: "plan_limit" });
      if (first.ok) await revokeInvitation(orgDeps(), t.actor, first.invitationId);
      expect(
        (
          await inviteMember(orgDeps(), t.actor, {
            email: `m3-${randomUUID().slice(0, 5)}@example.org`,
            role: "viewer",
          })
        ).ok,
      ).toBe(true);
      void listOrgAudit;
      void addTestMember;
    });
  });

  describe("storage", () => {
    it("refuses uploads beyond the storage allowance", async () => {
      const t = await tenant();
      await limit(t, "storage_mb", 1);
      const big = Buffer.concat([PNG, Buffer.alloc(600_000)]);
      expect(
        (
          await uploadAsset({ db, appUrl: APP }, t.actor, {
            bytes: big,
            filename: "a.png",
          })
        ).ok,
      ).toBe(true);
      expect(
        await uploadAsset({ db, appUrl: APP }, t.actor, {
          bytes: big,
          filename: "b.png",
        }),
      ).toMatchObject({ ok: false, code: "plan_limit" });
    });
  });

  describe("AI credits and automations", () => {
    it("monthly AI requests are capped by the plan", async () => {
      const t = await tenant();
      await limit(t, "ai_credits", 1);
      await setAiEnabledFor(
        { db, appUrl: APP, provider: null, dailyLimit: 50 },
        t.actor,
        true,
      );
      const tpl = await createTemplateFor({ db, appUrl: APP }, t.actor, {
        name: "T",
        category: "other",
      });
      if (!tpl.ok) throw new Error();
      const [c] = await db
        .insert(campaigns)
        .values({
          organizationId: t.org.id,
          name: "c",
          templateId: tpl.id,
          audience: { kind: "all" },
          utm: DEFAULT_UTM,
        })
        .returning();
      const deps = { db, appUrl: APP, provider: new MockAiProvider(), dailyLimit: 50 };
      expect((await suggestSubjectsFor(deps, t.actor, c!.id)).ok).toBe(true);
      expect(await suggestSubjectsFor(deps, t.actor, c!.id)).toMatchObject({
        code: "plan_limit",
      });
    });

    it("running automations are capped; archiving one frees the slot", async () => {
      const t = await tenant();
      await limit(t, "automations", 1);
      const domain = `bl-${randomUUID().slice(0, 8)}.com`;
      const d = (await createSenderDomain(db, t.oid, {
        domain,
        provider: "mock",
        dkimTokens: ["a", "b", "c"],
        ownershipToken: "t".repeat(32),
        userId: t.user.id,
      }))!;
      await db
        .update(senderDomains)
        .set({ status: "verified" })
        .where(eq(senderDomains.id, d.id));
      const identity = (await createSenderIdentity(db, t.oid, {
        fromName: "A",
        fromEmail: `i@${domain}`,
        replyTo: null,
        userId: t.user.id,
      }))!;
      const tpl = await createTemplateFor({ db, appUrl: APP }, t.actor, {
        name: "T",
        category: "other",
      });
      if (!tpl.ok) throw new Error();
      const make = async () => {
        const a = await createAutomationFor({ db, appUrl: APP }, t.actor, {
          name: "A",
          trigger: { type: "manual" },
        });
        if (!a.ok) throw new Error();
        await updateAutomationFor({ db, appUrl: APP }, t.actor, a.id, {
          steps: [
            {
              id: "e",
              type: "email",
              templateId: tpl.id,
              senderIdentityId: identity.id,
              subject: "Selam",
            },
          ],
        });
        return a.id;
      };
      const one = await make();
      const two = await make();
      expect((await activateAutomationFor({ db, appUrl: APP }, t.actor, one)).ok).toBe(
        true,
      );
      expect(
        await activateAutomationFor({ db, appUrl: APP }, t.actor, two),
      ).toMatchObject({ code: "plan_limit" });
      await archiveAutomationFor({ db, appUrl: APP }, t.actor, one);
      expect((await activateAutomationFor({ db, appUrl: APP }, t.actor, two)).ok).toBe(
        true,
      );
    });
  });

  describe("suspension", () => {
    it("a suspended workspace cannot schedule or activate sending, and can again once reinstated", async () => {
      const t = await tenant();
      const domain = `sp-${randomUUID().slice(0, 8)}.com`;
      const d = (await createSenderDomain(db, t.oid, {
        domain,
        provider: "mock",
        dkimTokens: ["a", "b", "c"],
        ownershipToken: "t".repeat(32),
        userId: t.user.id,
      }))!;
      await db
        .update(senderDomains)
        .set({ status: "verified" })
        .where(eq(senderDomains.id, d.id));
      const identity = (await createSenderIdentity(db, t.oid, {
        fromName: "A",
        fromEmail: `i@${domain}`,
        replyTo: null,
        userId: t.user.id,
      }))!;
      const tpl = await createTemplateFor({ db, appUrl: APP }, t.actor, {
        name: "T",
        category: "other",
      });
      if (!tpl.ok) throw new Error();
      await createContactFor({ db }, t.actor, contact("s1@example.org"));
      const c = await createCampaignFor(
        { db, appUrl: APP, sendTest: async () => {} },
        t.actor,
        { name: "S" },
      );
      if (!c.ok) throw new Error();
      await updateCampaignFor(
        { db, appUrl: APP, sendTest: async () => {} },
        t.actor,
        c.id,
        {
          subject: "Selam",
          templateId: tpl.id,
          senderIdentityId: identity.id,
          audience: { kind: "all" },
        },
      );
      await db
        .update(organizations)
        .set({ suspendedAt: new Date(), suspendedReason: "test" })
        .where(eq(organizations.id, t.org.id));
      expect(
        await scheduleCampaignFor(
          { db, appUrl: APP, sendTest: async () => {} },
          t.actor,
          c.id,
        ),
      ).toMatchObject({ ok: false, code: "suspended" });
      await db
        .update(organizations)
        .set({ suspendedAt: null })
        .where(eq(organizations.id, t.org.id));
      expect(
        (
          await scheduleCampaignFor(
            { db, appUrl: APP, sendTest: async () => {} },
            t.actor,
            c.id,
          )
        ).ok,
      ).toBe(true);
    });
  });
});
