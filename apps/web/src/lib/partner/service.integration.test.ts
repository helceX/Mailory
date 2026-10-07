import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  asOrganizationId,
  auditLogs,
  campaigns,
  checkEntitlement,
  createContact,
  createDb,
  getEffectiveLimits,
  memberships,
  organizations,
  templates,
  type Database,
} from "@mailory/db";
import { addTestMember, createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_UTM, type OrgRole } from "@mailory/core";
import { searchContacts } from "../audience/service";
import { getCampaignFor } from "../campaigns/service";
import { acceptInvitation, type Actor } from "../org/service";
import { createTemplateFor } from "../templates/service";
import * as platform from "../platform/service";
import * as partner from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const APP = "https://app.test";

suite("partner (BTM) admin, platform admin and template hub (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let mails: { to: string; text: string }[];
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  const deps = () => ({
    db,
    appUrl: APP,
    sendEmail: async (m: { to: string; text: string }) => void mails.push(m),
  });
  const actorFor = (userId: string, orgId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(orgId),
    role,
  });

  async function partnerOrg() {
    mails = [];
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    await db
      .update(organizations)
      .set({ type: "partner" })
      .where(eq(organizations.id, org.id));
    return { user, org, actor: actorFor(user.id, org.id, "owner") };
  }
  async function child(
    p: Awaited<ReturnType<typeof partnerOrg>>,
    plan?: Parameters<typeof partner.createEntrepreneurFor>[2]["planKey"],
  ) {
    const ownerEmail = `girisimci-${randomUUID().slice(0, 6)}@example.org`;
    const r = await partner.createEntrepreneurFor(deps(), p.actor, {
      name: `Girişimci ${randomUUID().slice(0, 4)}`,
      ownerEmail,
      planKey: plan,
    });
    if (!r.ok) throw new Error(`createEntrepreneur ${r.code}`);
    return { id: r.id, ownerEmail };
  }
  const ownerOf = async (orgId: string) => {
    const u = await createTestUser(db);
    await addTestMember(db, orgId, u.id, "owner");
    return actorFor(u.id, orgId, "owner");
  };

  describe("who may act as a partner", () => {
    it("only owners/admins of a PARTNER organization", async () => {
      const p = await partnerOrg();
      const editor = await (async () => {
        const u = await createTestUser(db);
        await addTestMember(db, p.org.id, u.id, "editor");
        return actorFor(u.id, p.org.id, "editor");
      })();
      expect(await partner.listChildrenFor(deps(), editor)).toMatchObject({
        code: "forbidden",
      });
      const plain = await createTestUser(db);
      const plainOrg = await createTestOrg(db, plain.id);
      const plainActor = actorFor(plain.id, plainOrg.id, "owner");
      for (const r of [
        await partner.listChildrenFor(deps(), plainActor),
        await partner.createEntrepreneurFor(deps(), plainActor, {
          name: "x",
          ownerEmail: "x@example.org",
        }),
        await partner.publishToHubFor(deps(), plainActor, { templateId: randomUUID() }),
      ])
        expect(r).toMatchObject({ ok: false, code: "forbidden" });
    });
  });

  describe("opening a workspace for an entrepreneur", () => {
    it("creates a sponsored child with NO sponsor member; the invited person becomes the owner", async () => {
      const p = await partnerOrg();
      const c = await child(p);
      const row = (
        await db.select().from(organizations).where(eq(organizations.id, c.id))
      )[0]!;
      expect(row).toMatchObject({ type: "standard", parentOrganizationId: p.org.id });
      expect(
        await db.select().from(memberships).where(eq(memberships.organizationId, c.id)),
      ).toHaveLength(0);
      expect((await getEffectiveLimits(db, asOrganizationId(c.id))).contacts).toBe(
        5000,
      ); // btm_sponsored
      const view = await partner.getChildFor(deps(), p.actor, c.id);
      expect(view.ok && view.entitlements).toMatchObject({
        planKey: "btm_sponsored",
        subscription: { source: "sponsored", sponsorOrganizationId: p.org.id },
      });
      // the invitation mail carries a token the entrepreneur can accept as OWNER
      const mail = mails.find((m) => m.to === c.ownerEmail)!;
      const token = /token=(\S+)/.exec(mail.text)![1]!;
      const entrepreneur = await createTestUser(db, { email: c.ownerEmail });
      const accepted = await acceptInvitation(
        deps(),
        { id: entrepreneur.id, email: c.ownerEmail },
        token,
      );
      expect(accepted).toMatchObject({ ok: true, role: "owner" });
      const members = await db
        .select()
        .from(memberships)
        .where(eq(memberships.organizationId, c.id));
      expect(members.map((m) => m.userId)).toEqual([entrepreneur.id]);
      expect(members.some((m) => m.userId === p.user.id)).toBe(false);
    });
    it("only sponsorable plans can be assigned", async () => {
      const p = await partnerOrg();
      expect(
        await partner.createEntrepreneurFor(deps(), p.actor, {
          name: "E",
          ownerEmail: "e@example.org",
          planKey: "enterprise",
        }),
      ).toMatchObject({ code: "invalid" });
    });
  });

  describe("the privacy boundary (D-007): sponsors see status and usage, never content", () => {
    it("child views are aggregate-only, and ordinary services never open a child's data to the partner", async () => {
      const p = await partnerOrg();
      const c = await child(p);
      const owner = await ownerOf(c.id);
      await createContact(db, asOrganizationId(c.id), {
        email: "gizli-kisi@example.org",
        firstName: "Gizli",
      });
      const [camp] = await db
        .insert(campaigns)
        .values({
          organizationId: c.id,
          name: "Gizli kampanya",
          subject: "Gizli konu",
          utm: DEFAULT_UTM,
        })
        .returning();
      await createTemplateFor({ db, appUrl: APP }, owner, {
        name: "Gizli şablon",
        category: "other",
      });

      const list = await partner.listChildrenFor(deps(), p.actor);
      if (!list.ok) throw new Error();
      const mine = list.children.find((x) => x.id === c.id)!;
      expect(mine).toMatchObject({
        contacts: 1,
        hasTemplate: true,
        hasSent: false,
        domainVerified: false,
      });
      const serialized = JSON.stringify(list);
      for (const secret of [
        "gizli-kisi",
        "Gizli",
        "Gizli kampanya",
        "Gizli konu",
        "Gizli şablon",
      ])
        expect(serialized).not.toContain(secret);
      expect(Object.keys(mine).sort()).toEqual([
        "contacts",
        "createdAt",
        "dailySendLimit",
        "domainVerified",
        "hasSent",
        "hasTemplate",
        "id",
        "lastSentAt",
        "members",
        "name",
        "parentOrganizationId",
        "planKey",
        "sentThisMonth",
        "source",
        "suspendedAt",
        "suspendedReason",
        "type",
      ]);
      // acting as the partner, the child's data is simply not there
      const contacts = await searchContacts({ db }, p.actor, {});
      expect(contacts.ok && JSON.stringify(contacts)).not.toContain("gizli-kisi");
      expect(
        await getCampaignFor(
          { db, appUrl: APP, sendTest: async () => {} },
          p.actor,
          camp!.id,
        ),
      ).toMatchObject({ ok: false, code: "not_found" });
    });
    it("a partner cannot see or touch another partner's children or an unrelated organization", async () => {
      const a = await partnerOrg();
      const b = await partnerOrg();
      const ca = await child(a);
      const stranger = await createTestUser(db);
      const strangerOrg = await createTestOrg(db, stranger.id);
      for (const id of [ca.id, strangerOrg.id]) {
        for (const r of [
          await partner.getChildFor(deps(), b.actor, id),
          await partner.setChildPlanFor(deps(), b.actor, id, "starter"),
          await partner.setChildLimitFor(deps(), b.actor, id, {
            key: "contacts",
            limit: 10,
            reason: null,
          }),
          await partner.suspendChildFor(deps(), b.actor, id, "x"),
          await partner.endSponsorshipFor(deps(), b.actor, id),
        ])
          expect(r).toMatchObject({ ok: false, code: "not_found" });
      }
      const listB = await partner.listChildrenFor(deps(), b.actor);
      expect(listB.ok && listB.children).toEqual([]);
      expect(
        (
          await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, strangerOrg.id))
        )[0]!.suspendedAt,
      ).toBeNull();
    });
  });

  describe("limits, suspension and ending sponsorship", () => {
    it("a partner may raise a limit up to the pro cap, never beyond; clearing restores the plan", async () => {
      const p = await partnerOrg();
      const c = await child(p);
      const id = asOrganizationId(c.id);
      expect(
        (
          await partner.setChildLimitFor(deps(), p.actor, c.id, {
            key: "contacts",
            limit: 20000,
            reason: "pilot",
          })
        ).ok,
      ).toBe(true);
      expect((await getEffectiveLimits(db, id)).contacts).toBe(20000);
      expect(
        await partner.setChildLimitFor(deps(), p.actor, c.id, {
          key: "contacts",
          limit: 50_001,
          reason: null,
        }),
      ).toMatchObject({ code: "cap_exceeded" });
      expect(
        await partner.setChildLimitFor(deps(), p.actor, c.id, {
          key: "contacts",
          limit: -1,
          reason: null,
        }),
      ).toMatchObject({ code: "invalid" });
      expect(
        (
          await partner.setChildLimitFor(deps(), p.actor, c.id, {
            key: "contacts",
            limit: "clear",
            reason: null,
          })
        ).ok,
      ).toBe(true);
      expect((await getEffectiveLimits(db, id)).contacts).toBe(5000);
    });
    it("suspending blocks the child and reinstating restores it; ending sponsorship drops to the free plan", async () => {
      const p = await partnerOrg();
      const c = await child(p);
      expect(await partner.suspendChildFor(deps(), p.actor, c.id, "  ")).toMatchObject({
        code: "invalid",
      });
      await partner.suspendChildFor(deps(), p.actor, c.id, "Kullanım şartları ihlali");
      expect(
        (await db.select().from(organizations).where(eq(organizations.id, c.id)))[0],
      ).toMatchObject({ suspendedReason: "Kullanım şartları ihlali" });
      await partner.suspendChildFor(deps(), p.actor, c.id, null);
      expect(
        (await db.select().from(organizations).where(eq(organizations.id, c.id)))[0]!
          .suspendedAt,
      ).toBeNull();
      await partner.endSponsorshipFor(deps(), p.actor, c.id);
      expect(
        (await checkEntitlement(db, asOrganizationId(c.id), "contacts", 0)).limit,
      ).toBe(500);
    });
    it("every partner action is audited against the child, naming the sponsor", async () => {
      const p = await partnerOrg();
      const c = await child(p);
      await partner.setChildPlanFor(deps(), p.actor, c.id, "starter");
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, c.id),
            eq(auditLogs.entityType, "organization"),
          ),
        );
      expect(rows.map((r) => r.action)).toEqual(
        expect.arrayContaining(["partner.child_created", "partner.plan_set"]),
      );
      expect(
        rows.every(
          (r) =>
            (r.metadata as { partnerOrganizationId?: string }).partnerOrganizationId ===
            p.org.id,
        ),
      ).toBe(true);
    });
  });

  describe("Template Hub", () => {
    it("publishes a snapshot; sponsored workspaces see and copy only their sponsor's hub; copies are independent", async () => {
      const p = await partnerOrg();
      const other = await partnerOrg();
      const c = await child(p);
      const owner = await ownerOf(c.id);
      const lone = await createTestOrg(db, (await createTestUser(db)).id);
      const loneActor = actorFor(
        (
          await db
            .select()
            .from(memberships)
            .where(eq(memberships.organizationId, lone.id))
        )[0]!.userId,
        lone.id,
        "owner",
      );
      const t = await createTemplateFor({ db, appUrl: APP }, p.actor, {
        name: "BTM Karşılama",
        category: "other",
      });
      if (!t.ok) throw new Error();
      const pub = await partner.publishToHubFor(deps(), p.actor, {
        templateId: t.id,
        description: "Girişimciler için",
      });
      if (!pub.ok) throw new Error(pub.code);
      expect((await partner.listHubFor(deps(), p.actor)).ok).toBe(true);

      const seen = await partner.listHubForChild(deps(), owner);
      expect(seen.ok && seen.templates.map((x) => x.name)).toEqual(["BTM Karşılama"]);
      expect(seen.ok && seen.sponsorName).toBeTruthy();
      const none = await partner.listHubForChild(deps(), loneActor);
      expect(none.ok && none.templates).toEqual([]);
      expect(await partner.useHubTemplateFor(deps(), loneActor, pub.id)).toMatchObject({
        code: "not_found",
      });
      const otherChild = await ownerOf((await child(other)).id);
      expect(await partner.useHubTemplateFor(deps(), otherChild, pub.id)).toMatchObject(
        { code: "not_found" },
      );

      const used = await partner.useHubTemplateFor(deps(), owner, pub.id);
      expect(used.ok).toBe(true);
      const again = await partner.useHubTemplateFor(deps(), owner, pub.id);
      expect(again.ok).toBe(true); // name collision handled
      expect(
        await db.select().from(templates).where(eq(templates.organizationId, c.id)),
      ).toHaveLength(2);

      // unpublishing hides it for new use but leaves existing copies alone
      expect((await partner.unpublishFromHubFor(deps(), p.actor, pub.id)).ok).toBe(
        true,
      );
      const after = await partner.listHubForChild(deps(), owner);
      expect(after.ok && after.templates).toEqual([]);
      expect(await partner.useHubTemplateFor(deps(), owner, pub.id)).toMatchObject({
        code: "not_found",
      });
      expect(
        await db.select().from(templates).where(eq(templates.organizationId, c.id)),
      ).toHaveLength(2);
    });
    it("a partner publishes only its own templates", async () => {
      const a = await partnerOrg();
      const b = await partnerOrg();
      const t = await createTemplateFor({ db, appUrl: APP }, a.actor, {
        name: "Özel",
        category: "other",
      });
      if (!t.ok) throw new Error();
      expect(
        await partner.publishToHubFor(deps(), b.actor, { templateId: t.id }),
      ).toMatchObject({ code: "not_found" });
    });
  });

  describe("platform admin", () => {
    let adminUserId = "";
    beforeAll(async () => {
      adminUserId = (await createTestUser(db)).id;
    });
    const admin = (): platform.PlatformActor => ({
      userId: adminUserId,
      isPlatformAdmin: true,
    });
    const nobody: platform.PlatformActor = {
      userId: randomUUID(),
      isPlatformAdmin: false,
    };
    const pdeps = () => deps();

    it("everything is refused to non-admins", async () => {
      const t = await partnerOrg();
      for (const r of [
        await platform.listOrgsFor(pdeps(), nobody),
        await platform.getOrgFor(pdeps(), nobody, t.org.id),
        await platform.setPlanFor(pdeps(), nobody, t.org.id, { planKey: "pro" }),
        await platform.setLimitFor(pdeps(), nobody, t.org.id, {
          key: "contacts",
          limit: 1,
          reason: null,
        }),
        await platform.setDailyLimitFor(pdeps(), nobody, t.org.id, 1),
        await platform.suspendFor(pdeps(), nobody, t.org.id, "x"),
        await platform.setKindFor(pdeps(), nobody, t.org.id, {
          type: "standard",
          parentOrganizationId: null,
        }),
        await platform.createPartnerFor(pdeps(), nobody, {
          name: "BTM",
          ownerEmail: "a@example.org",
        }),
      ])
        expect(r).toMatchObject({ ok: false, code: "forbidden" });
    });
    it("lists orgs with aggregate metrics and finds by name", async () => {
      const t = await partnerOrg();
      const r = await platform.listOrgsFor(
        pdeps(),
        admin(),
        (
          await db.select().from(organizations).where(eq(organizations.id, t.org.id))
        )[0]!.name,
      );
      expect(r.ok && r.orgs.map((o) => o.id)).toContain(t.org.id);
      expect(r.ok && JSON.stringify(r)).not.toMatch(/@example\.org/);
    });
    it("sets plan, limits (including unlimited), daily limit, suspension — all audited", async () => {
      const t = await partnerOrg();
      const a = admin();
      expect(
        (await platform.setPlanFor(pdeps(), a, t.org.id, { planKey: "pro" })).ok,
      ).toBe(true);
      expect(
        (await checkEntitlement(db, asOrganizationId(t.org.id), "contacts", 0)).limit,
      ).toBe(50000);
      await platform.setLimitFor(pdeps(), a, t.org.id, {
        key: "contacts",
        limit: null,
        reason: "kurumsal",
      });
      expect(
        (await checkEntitlement(db, asOrganizationId(t.org.id), "contacts", 0)).limit,
      ).toBeNull();
      expect(
        await platform.setLimitFor(pdeps(), a, t.org.id, {
          key: "contacts",
          limit: -5,
          reason: null,
        }),
      ).toMatchObject({ code: "invalid" });
      expect((await platform.setDailyLimitFor(pdeps(), a, t.org.id, 123)).ok).toBe(
        true,
      );
      expect(
        (
          await db.select().from(organizations).where(eq(organizations.id, t.org.id))
        )[0]!.dailySendLimit,
      ).toBe(123);
      expect(await platform.suspendFor(pdeps(), a, t.org.id, "")).toMatchObject({
        code: "invalid",
      });
      await platform.suspendFor(pdeps(), a, t.org.id, "Şikayet oranı");
      await platform.suspendFor(pdeps(), a, t.org.id, null);
      const actions = (
        await db.select().from(auditLogs).where(eq(auditLogs.organizationId, t.org.id))
      ).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "platform.plan_set",
          "platform.limit_set",
          "platform.daily_limit_set",
          "platform.suspended",
          "platform.reinstated",
        ]),
      );
      expect(await platform.getOrgFor(pdeps(), a, randomUUID())).toMatchObject({
        code: "not_found",
      });
    });
    it("re-parenting rules: parent must be a partner, partners have no parent, no self-parenting", async () => {
      const p = await partnerOrg();
      const plain = await createTestOrg(db, (await createTestUser(db)).id);
      const a = admin();
      expect(
        (
          await platform.setKindFor(pdeps(), a, plain.id, {
            type: "standard",
            parentOrganizationId: p.org.id,
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await db.select().from(organizations).where(eq(organizations.id, plain.id))
        )[0]!.parentOrganizationId,
      ).toBe(p.org.id);
      expect(
        await platform.setKindFor(pdeps(), a, plain.id, {
          type: "standard",
          parentOrganizationId: plain.id,
        }),
      ).toMatchObject({ code: "invalid" });
      const notPartner = await createTestOrg(db, (await createTestUser(db)).id);
      expect(
        await platform.setKindFor(pdeps(), a, plain.id, {
          type: "standard",
          parentOrganizationId: notPartner.id,
        }),
      ).toMatchObject({ code: "invalid" });
      expect(
        await platform.setKindFor(pdeps(), a, plain.id, {
          type: "partner",
          parentOrganizationId: p.org.id,
        }),
      ).toMatchObject({ code: "invalid" });
    });
    it("creates a partner workspace with no members and an owner invitation", async () => {
      mails = [];
      const r = await platform.createPartnerFor(pdeps(), admin(), {
        name: `BTM ${randomUUID().slice(0, 4)}`,
        ownerEmail: "BTM-Yonetici@Example.org",
      });
      if (!r.ok) throw new Error(r.code);
      expect(
        (await db.select().from(organizations).where(eq(organizations.id, r.id)))[0],
      ).toMatchObject({ type: "partner" });
      expect(
        await db.select().from(memberships).where(eq(memberships.organizationId, r.id)),
      ).toHaveLength(0);
      expect(mails.find((m) => m.to === "btm-yonetici@example.org")).toBeTruthy();
      expect(
        (await checkEntitlement(db, asOrganizationId(r.id), "contacts", 0)).limit,
      ).toBeNull(); // enterprise
    });
  });
});
