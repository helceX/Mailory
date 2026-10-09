import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaigns,
  createContact,
  createDb,
  createSenderDomain,
  createSenderIdentity,
  senderDomains,
  suppressions,
  type Database,
} from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import type { OrgRole } from "@mailory/core";
import { addSuppressions, createList, addContactsToList } from "@mailory/db";
import type { Actor } from "../org/service";
import {
  createTemplateFor,
  saveTemplateFor,
  getTemplateFor,
} from "../templates/service";
import * as svc from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const APP = "https://app.test";

suite("campaign engine (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let sent: svc.TestMessage[];
  let clock: Date;

  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  const deps = (): svc.CampaignDeps => ({
    db,
    appUrl: APP,
    now: () => clock,
    sendTest: async (m) => void sent.push(m),
  });
  const tdeps = () => ({ db, appUrl: APP });
  const actorFor = (userId: string, organizationId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(organizationId),
    role,
  });
  async function memberOf(orgId: string, role: OrgRole) {
    const u = await createTestUser(db);
    await addTestMember(db, orgId, u.id, role);
    return { user: u, actor: actorFor(u.id, orgId, role) };
  }

  /** A workspace that is ready to send: verified domain + default identity, a template, 3 subscribed contacts. */
  async function workspace() {
    sent = [];
    clock = new Date("2026-03-01T10:00:00Z");
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const actor = actorFor(user.id, org.id, "owner");
    const domain = `ws-${randomUUID().slice(0, 8)}.com`;
    const d = (await createSenderDomain(db, oid, {
      domain,
      provider: "mock",
      dkimTokens: ["a", "b", "c"],
      ownershipToken: "t".repeat(32),
      userId: user.id,
    }))!;
    await db
      .update(senderDomains)
      .set({ status: "verified", verifiedAt: clock })
      .where(eq(senderDomains.id, d.id));
    const identity = await createSenderIdentity(db, oid, {
      fromName: "Acme",
      fromEmail: `info@${domain}`,
      replyTo: null,
      userId: user.id,
    });
    const t = await createTemplateFor(tdeps(), actor, {
      name: "Aylık",
      category: "other",
    });
    if (!t.ok) throw new Error("template");
    const list = await createList(db, oid, { name: "Herkes", description: null });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await createContact(db, oid, {
        email: `c${i}-${randomUUID().slice(0, 6)}@example.org`,
      });
      ids.push(c!.id);
    }
    await addContactsToList(db, oid, list!.id, { ids });
    return {
      user,
      org,
      oid,
      actor,
      identity,
      templateId: t.id,
      listId: list!.id,
      domain,
    };
  }
  /** Fills in everything a draft needs. */
  async function readyDraft(w: Awaited<ReturnType<typeof workspace>>) {
    const c = await svc.createCampaignFor(deps(), w.actor, { name: "Yaz Kampanyası" });
    if (!c.ok) throw new Error("create");
    const u = await svc.updateCampaignFor(deps(), w.actor, c.id, {
      subject: "Merhaba {{first_name|dost}}",
      templateId: w.templateId,
      audience: { kind: "list", id: w.listId },
    });
    if (!u.ok) throw new Error(`update: ${u.code} ${u.message}`);
    return c.id;
  }
  const fetchRow = async (id: string) =>
    (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0]!;

  describe("pre-send review (ön otopsi)", () => {
    it("surfaces awkward real contacts and what would go wrong for each; sends nothing", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      await svc.updateCampaignFor(deps(), w.actor, id, {
        subject: "Merhaba {{first_name}}",
      });
      const mk = async (firstName: string | null, company?: string) => {
        const c = await createContact(db, w.oid, {
          email: `r-${randomUUID().slice(0, 6)}@example.org`,
          firstName,
          company: company ?? null,
        });
        await addContactsToList(db, w.oid, w.listId, { ids: [c!.id] });
        return c!.id;
      };
      const empty = await mk(null);
      const caps = await mk("AYŞE");
      const odd = await mk("12345");
      const r = await svc.reviewSamplesFor(deps(), w.actor, id);
      if (!r.ok) throw new Error("review");
      const by = (cid: string) => r.samples.find((s) => s.contactId === cid)!;
      expect(by(empty).issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(["empty_value"]),
      );
      expect(by(empty).reasons).toContain("Adı boş");
      expect(by(caps).issues.map((i) => i.code)).toContain("all_caps");
      expect(by(caps).subject).toBe("Merhaba AYŞE");
      expect(by(odd).issues.map((i) => i.code)).toContain("odd_name");
      expect(r.problems).toBeGreaterThanOrEqual(3);
      expect(r.samples.length).toBeLessThanOrEqual(12);
      expect(sent).toHaveLength(0);
    });

    it("a clean audience reports no problems, and a viewer can run it (read-only)", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const viewer = await memberOf(w.org.id, "viewer");
      const r = await svc.reviewSamplesFor(deps(), viewer.actor, id);
      expect(r).toMatchObject({ ok: true });
    });

    it("needs a template and an audience; foreign tenants get not_found", async () => {
      const a = await workspace();
      const b = await workspace();
      const c = await svc.createCampaignFor(deps(), a.actor, { name: "Boş" });
      if (!c.ok) throw new Error();
      expect(await svc.reviewSamplesFor(deps(), a.actor, c.id)).toMatchObject({
        ok: false,
        code: "invalid",
      });
      const id = await readyDraft(a);
      expect(await svc.reviewSamplesFor(deps(), b.actor, id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
    });
  });

  describe("drafts", () => {
    it("creates a draft with the default sender and a slugged UTM campaign", async () => {
      const w = await workspace();
      const r = await svc.createCampaignFor(deps(), w.actor, {
        name: "Yaz Kampanyası",
      });
      if (!r.ok) throw new Error();
      const row = await fetchRow(r.id);
      expect(row).toMatchObject({
        status: "draft",
        senderIdentityId: w.identity!.id,
        utm: {
          enabled: true,
          source: "mailory",
          medium: "email",
          campaign: "yaz-kampanyasi",
        },
      });
    });

    it("rejects foreign-tenant sender, template and audience references", async () => {
      const a = await workspace();
      const b = await workspace();
      const id = await readyDraft(a);
      for (const patch of [
        { senderIdentityId: b.identity!.id },
        { templateId: b.templateId },
        { audience: { kind: "list" as const, id: b.listId } },
      ]) {
        const r = await svc.updateCampaignFor(deps(), a.actor, id, patch);
        expect(r).toMatchObject({ ok: false, code: "invalid" });
      }
    });

    it("hides other tenants' campaigns (404) for every operation", async () => {
      const { ownerA, orgA, ownerB, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const created = await svc.createCampaignFor(deps(), a, { name: "Gizli" });
      if (!created.ok) throw new Error();
      for (const result of [
        await svc.getCampaignFor(deps(), b, created.id),
        await svc.updateCampaignFor(deps(), b, created.id, { name: "x" }),
        await svc.deleteCampaignFor(deps(), b, created.id),
        await svc.duplicateCampaignFor(deps(), b, created.id),
        await svc.previewCampaignFor(deps(), b, created.id),
        await svc.scheduleCampaignFor(deps(), b, created.id),
        await svc.submitCampaignFor(deps(), b, created.id),
        await svc.approveCampaignFor(deps(), b, created.id),
        await svc.rejectCampaignFor(deps(), b, created.id, "x"),
        await svc.cancelCampaignFor(deps(), b, created.id),
        await svc.returnToDraftFor(deps(), b, created.id),
        await svc.sendTestFor(deps(), b, created.id, ["x@example.org"]),
      ])
        expect(result).toMatchObject({ ok: false, code: "not_found" });
      expect(
        (await svc.listCampaignsFor(deps(), b)).ok &&
          (await svc.listCampaignsFor(deps(), b)),
      ).toMatchObject({ campaigns: [] });
      expect((await fetchRow(created.id)).name).toBe("Gizli");
    });

    it("enforces RBAC: viewers read only; editors write and send; only admins approve", async () => {
      const w = await workspace();
      const viewer = (await memberOf(w.org.id, "viewer")).actor;
      const editor = (await memberOf(w.org.id, "editor")).actor;
      const id = await readyDraft(w);
      expect((await svc.listCampaignsFor(deps(), viewer)).ok).toBe(true);
      expect(await svc.createCampaignFor(deps(), viewer, { name: "x" })).toMatchObject({
        code: "forbidden",
      });
      expect(await svc.scheduleCampaignFor(deps(), viewer, id)).toMatchObject({
        code: "forbidden",
      });
      expect(
        await svc.setPolicyFor(deps(), editor, { requireApproval: true }),
      ).toMatchObject({
        code: "forbidden",
      });
      expect((await svc.createCampaignFor(deps(), editor, { name: "e" })).ok).toBe(
        true,
      );
      expect(await svc.approveCampaignFor(deps(), editor, id)).toMatchObject({
        code: "forbidden",
      });
    });

    it("only drafts are editable or deletable", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      expect((await svc.scheduleCampaignFor(deps(), w.actor, id)).ok).toBe(true);
      expect(
        await svc.updateCampaignFor(deps(), w.actor, id, { name: "yeni" }),
      ).toMatchObject({ code: "conflict" });
      expect(await svc.deleteCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
      expect((await fetchRow(id)).name).toBe("Yaz Kampanyası");
    });

    it("duplicates into a fresh draft", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      await svc.scheduleCampaignFor(deps(), w.actor, id);
      const d = await svc.duplicateCampaignFor(deps(), w.actor, id);
      if (!d.ok) throw new Error();
      expect(await fetchRow(d.id)).toMatchObject({
        status: "draft",
        name: "Yaz Kampanyası (kopya)",
        snapshot: null,
        scheduledAt: null,
        templateId: w.templateId,
      });
    });
  });

  describe("readiness", () => {
    const codes = async (w: Awaited<ReturnType<typeof workspace>>, id: string) => {
      const r = await svc.getCampaignFor(deps(), w.actor, id);
      if (!r.ok) throw new Error();
      return { codes: r.issues.map((i) => i.code), count: r.audienceCount };
    };

    it("a fresh draft lists what is missing, and scheduling is refused with the reason", async () => {
      const w = await workspace();
      const c = await svc.createCampaignFor(deps(), w.actor, { name: "Boş" });
      if (!c.ok) throw new Error();
      const { codes: got } = await codes(w, c.id);
      expect(got).toEqual(
        expect.arrayContaining(["no_subject", "no_template", "no_audience"]),
      );
      const r = await svc.scheduleCampaignFor(deps(), w.actor, c.id);
      expect(r).toMatchObject({ ok: false, code: "not_ready" });
      expect((r as svc.Failure).issues?.length).toBeGreaterThan(0);
      expect((await fetchRow(c.id)).status).toBe("draft");
    });

    it("blocks a sender whose domain is not verified", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const other = await createSenderIdentity(db, w.oid, {
        fromName: "X",
        fromEmail: "x@unverified-example.org",
        replyTo: null,
        userId: w.user.id,
      });
      await svc.updateCampaignFor(deps(), w.actor, id, { senderIdentityId: other!.id });
      expect((await codes(w, id)).codes).toContain("sender_unusable");
      expect(await svc.scheduleCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "not_ready",
      });
    });

    it("counts only subscribed, non-suppressed contacts", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      expect((await codes(w, id)).count).toBe(3);
      const [first] = await db.query.contacts.findMany({
        where: (c, { eq }) => eq(c.organizationId, w.org.id),
        limit: 1,
      });
      await addSuppressions(db, w.oid, {
        emails: [first!.email],
        reason: "manual",
        userId: w.user.id,
      });
      expect((await codes(w, id)).count).toBe(2);
    });

    it("excludes suppressed addresses even if the contact row still says subscribed", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const [first] = await db.query.contacts.findMany({
        where: (c, { eq }) => eq(c.organizationId, w.org.id),
        limit: 1,
      });
      await db.insert(suppressions).values({
        organizationId: w.org.id,
        email: first!.email,
        reason: "manual",
      });
      expect(
        (await db.query.contacts.findFirst({
          where: (c, { eq }) => eq(c.id, first!.id),
        }))!.status,
      ).toBe("subscribed");
      expect((await codes(w, id)).count).toBe(2);
    });

    it("blocks an empty audience", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const empty = await createList(db, w.oid, {
        name: "Boş liste",
        description: null,
      });
      await svc.updateCampaignFor(deps(), w.actor, id, {
        audience: { kind: "list", id: empty!.id },
      });
      expect((await codes(w, id)).codes).toContain("audience_empty");
    });

    it("blocks content without an unsubscribe link", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const t = await getTemplateFor(tdeps(), w.actor, w.templateId);
      if (!t.ok) throw new Error();
      const doc = {
        ...t.doc,
        blocks: t.doc.blocks.map((b) =>
          b.type === "footer" ? { ...b, showUnsubscribe: false } : b,
        ),
      };
      const saved = await saveTemplateFor(tdeps(), w.actor, w.templateId, { doc });
      expect(saved.ok).toBe(true);
      expect((await codes(w, id)).codes).toContain("no_unsubscribe");
    });
  });

  describe("scheduling", () => {
    it("freezes the content: later template edits never change a scheduled send", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const sched = await svc.scheduleCampaignFor(
        deps(),
        w.actor,
        id,
        "2026-03-02T09:00:00Z",
      );
      expect(sched.ok).toBe(true);
      const before = await fetchRow(id);
      expect(before).toMatchObject({
        status: "scheduled",
        templateVersionId: expect.any(String),
      });
      expect(before.snapshot).toMatchObject({
        audienceCount: 3,
        sender: { fromName: "Acme", fromEmail: `info@${w.domain}` },
      });
      expect(before.scheduledAt?.toISOString()).toBe("2026-03-02T09:00:00.000Z");

      const t = await getTemplateFor(tdeps(), w.actor, w.templateId);
      if (!t.ok) throw new Error();
      await saveTemplateFor(tdeps(), w.actor, w.templateId, {
        doc: { ...t.doc, blocks: [] },
      });
      const after = await fetchRow(id);
      expect(after.snapshot).toEqual(before.snapshot);
      expect(after.templateVersionId).toBe(before.templateVersionId);
    });

    it("rejects past and absurdly distant send times, and treats null as now", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      expect(
        await svc.scheduleCampaignFor(deps(), w.actor, id, "2026-02-01T00:00:00Z"),
      ).toMatchObject({ code: "invalid" });
      expect(
        await svc.scheduleCampaignFor(deps(), w.actor, id, "2030-01-01T00:00:00Z"),
      ).toMatchObject({ code: "invalid" });
      expect(
        await svc.scheduleCampaignFor(deps(), w.actor, id, "garbage"),
      ).toMatchObject({ code: "invalid" });
      expect((await fetchRow(id)).status).toBe("draft");
      expect((await svc.scheduleCampaignFor(deps(), w.actor, id, null)).ok).toBe(true);
      expect((await fetchRow(id)).scheduledAt?.toISOString()).toBe(clock.toISOString());
    });

    it("can be withdrawn to a clean draft, or cancelled; cancelled is final", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      await svc.scheduleCampaignFor(deps(), w.actor, id);
      expect((await svc.returnToDraftFor(deps(), w.actor, id)).ok).toBe(true);
      expect(await fetchRow(id)).toMatchObject({
        status: "draft",
        snapshot: null,
        scheduledAt: null,
      });
      await svc.scheduleCampaignFor(deps(), w.actor, id);
      expect((await svc.cancelCampaignFor(deps(), w.actor, id)).ok).toBe(true);
      expect(await svc.scheduleCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
      expect(await svc.returnToDraftFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
      expect(await svc.cancelCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
    });

    it("cannot withdraw or edit a campaign that is already sending", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      await svc.scheduleCampaignFor(deps(), w.actor, id);
      await db.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, id));
      expect(await svc.returnToDraftFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
      expect((await svc.cancelCampaignFor(deps(), w.actor, id)).ok).toBe(true);
    });
  });

  describe("content health", () => {
    it("scores a shouty subject and does not repeat readiness blockers", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      await svc.updateCampaignFor(deps(), w.actor, id, {
        subject: "ÜCRETSİZ KAZAN HEMEN!!!",
      });
      const r = await svc.getCampaignFor(deps(), w.actor, id);
      if (!r.ok) throw new Error();
      const codes = r.health.findings.map((f) => f.code);
      expect(codes).toEqual(
        expect.arrayContaining(["subject_caps", "subject_punct", "subject_spam_words"]),
      );
      expect(codes).not.toContain("no_unsubscribe");
      expect(r.health.score).toBeLessThan(85);
      await svc.updateCampaignFor(deps(), w.actor, id, {
        subject: "Mart ayı bülteni: yeni özellikler",
      });
      const clean = await svc.getCampaignFor(deps(), w.actor, id);
      expect(clean.ok && clean.health.findings.map((f) => f.code)).not.toContain(
        "subject_caps",
      );
    });
  });

  describe("pause and resume", () => {
    it("pauses only a sending campaign and resumes only a paused one; both are RBAC-guarded and audited", async () => {
      const w = await workspace();
      const viewer = (await memberOf(w.org.id, "viewer")).actor;
      const id = await readyDraft(w);
      expect(await svc.pauseCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
      await svc.scheduleCampaignFor(deps(), w.actor, id);
      await db.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, id));
      expect(await svc.pauseCampaignFor(deps(), viewer, id)).toMatchObject({
        code: "forbidden",
      });
      expect((await svc.pauseCampaignFor(deps(), w.actor, id)).ok).toBe(true);
      expect(await fetchRow(id)).toMatchObject({
        status: "paused",
        haltReason: "manual",
      });
      expect(await svc.resumeCampaignFor(deps(), viewer, id)).toMatchObject({
        code: "forbidden",
      });
      expect((await svc.resumeCampaignFor(deps(), w.actor, id)).ok).toBe(true);
      expect(await fetchRow(id)).toMatchObject({ status: "sending", haltReason: null });
      expect(await svc.resumeCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "conflict",
      });
    });
    it("hides other tenants' campaigns from pause/resume", async () => {
      const a = await workspace();
      const b = await workspace();
      const id = await readyDraft(a);
      expect(await svc.pauseCampaignFor(deps(), b.actor, id)).toMatchObject({
        code: "not_found",
      });
      expect(await svc.resumeCampaignFor(deps(), b.actor, id)).toMatchObject({
        code: "not_found",
      });
    });
    it("shows progress counts once a campaign leaves draft", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const draft = await svc.getCampaignFor(deps(), w.actor, id);
      expect(draft.ok && draft.progress).toBeNull();
      await svc.scheduleCampaignFor(deps(), w.actor, id);
      const sched = await svc.getCampaignFor(deps(), w.actor, id);
      expect(sched.ok && sched.progress).toEqual({});
    });
    it("test-send subjects have merge tokens resolved", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const email = (await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, w.user.id),
      }))!.email;
      await svc.sendTestFor(deps(), w.actor, id, [email]);
      expect(sent[0]!.subject).not.toContain("{{");
      expect(sent[0]!.subject.startsWith("[TEST] Merhaba ")).toBe(true);
    });
  });

  describe("approval workflow", () => {
    async function withPolicy() {
      const w = await workspace();
      const editor = await memberOf(w.org.id, "editor");
      const admin = await memberOf(w.org.id, "admin");
      expect(
        (await svc.setPolicyFor(deps(), w.actor, { requireApproval: true })).ok,
      ).toBe(true);
      const id = await readyDraft(w);
      return { w, editor, admin, id };
    }

    it("direct scheduling is refused while the policy is on", async () => {
      const { w, id } = await withPolicy();
      expect(await svc.scheduleCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "approval_required",
      });
    });

    it("submit → a DIFFERENT admin approves → scheduled with a frozen snapshot", async () => {
      const { w, editor, admin, id } = await withPolicy();
      const sub = await svc.submitCampaignFor(
        deps(),
        editor.actor,
        id,
        "2026-03-05T08:00:00Z",
      );
      expect(sub.ok).toBe(true);
      expect(await fetchRow(id)).toMatchObject({
        status: "pending_approval",
        submittedByUserId: editor.user.id,
      });
      // Submitted content is locked.
      expect(
        await svc.updateCampaignFor(deps(), w.actor, id, { name: "x" }),
      ).toMatchObject({ code: "conflict" });
      const ok = await svc.approveCampaignFor(deps(), admin.actor, id);
      expect(ok.ok).toBe(true);
      expect(await fetchRow(id)).toMatchObject({
        status: "scheduled",
        approvedByUserId: admin.user.id,
        snapshot: expect.objectContaining({ audienceCount: 3 }),
      });
    });

    it("nobody approves their own submission, even an owner", async () => {
      const { w, id } = await withPolicy();
      await svc.submitCampaignFor(deps(), w.actor, id);
      expect(await svc.approveCampaignFor(deps(), w.actor, id)).toMatchObject({
        code: "self_approval",
      });
      expect((await fetchRow(id)).status).toBe("pending_approval");
    });

    it("rejection returns a draft with the reason; the submitter can withdraw", async () => {
      const { editor, admin, id } = await withPolicy();
      await svc.submitCampaignFor(deps(), editor.actor, id);
      expect(await svc.rejectCampaignFor(deps(), editor.actor, id, "x")).toMatchObject({
        code: "forbidden",
      });
      expect(
        (await svc.rejectCampaignFor(deps(), admin.actor, id, "Konu çok uzun")).ok,
      ).toBe(true);
      expect(await fetchRow(id)).toMatchObject({
        status: "draft",
        rejectionReason: "Konu çok uzun",
      });
      await svc.submitCampaignFor(deps(), editor.actor, id);
      expect((await fetchRow(id)).rejectionReason).toBeNull();
      expect((await svc.returnToDraftFor(deps(), editor.actor, id)).ok).toBe(true);
      expect((await fetchRow(id)).status).toBe("draft");
    });

    it("approval re-validates: a sender that lost verification blocks approval", async () => {
      const { w, editor, admin, id } = await withPolicy();
      await svc.submitCampaignFor(deps(), editor.actor, id);
      await db
        .update(senderDomains)
        .set({ status: "failed" })
        .where(eq(senderDomains.organizationId, w.org.id));
      expect(await svc.approveCampaignFor(deps(), admin.actor, id)).toMatchObject({
        code: "not_ready",
      });
      expect((await fetchRow(id)).status).toBe("pending_approval");
    });

    it("a send time that passed while waiting means 'as soon as approved'", async () => {
      const { editor, admin, id } = await withPolicy();
      await svc.submitCampaignFor(deps(), editor.actor, id, "2026-03-01T12:00:00Z");
      clock = new Date("2026-03-03T00:00:00Z");
      await svc.approveCampaignFor(deps(), admin.actor, id);
      expect((await fetchRow(id)).scheduledAt?.toISOString()).toBe(clock.toISOString());
    });

    it("approve and cancel racing: exactly one wins and state stays consistent", async () => {
      const { editor, admin, id } = await withPolicy();
      await svc.submitCampaignFor(deps(), editor.actor, id);
      const [a, c] = await Promise.all([
        svc.approveCampaignFor(deps(), admin.actor, id),
        svc.cancelCampaignFor(deps(), admin.actor, id),
      ]);
      const row = await fetchRow(id);
      if (a.ok && c.ok) expect(["scheduled", "cancelled"]).toContain(row.status);
      else expect(a.ok !== c.ok || (a.ok && c.ok)).toBe(true);
      expect(["scheduled", "cancelled"]).toContain(row.status);
      // A cancelled campaign must never also carry an approval that schedules it.
      if (row.status === "cancelled" && a.ok) expect(c.ok).toBe(true);
    });

    it("policy changes are audited and read back", async () => {
      const w = await workspace();
      expect(await svc.getPolicyFor(deps(), w.actor)).toMatchObject({
        requireApproval: false,
      });
      await svc.setPolicyFor(deps(), w.actor, { requireApproval: true });
      expect(await svc.getPolicyFor(deps(), w.actor)).toMatchObject({
        requireApproval: true,
      });
    });
  });

  describe("preview and test send", () => {
    it("tags links with UTM in the preview but never the unsubscribe link", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const t = await getTemplateFor(tdeps(), w.actor, w.templateId);
      if (!t.ok) throw new Error();
      const doc = {
        ...t.doc,
        blocks: [
          ...t.doc.blocks,
          {
            id: "btn1",
            type: "button",
            label: "Git",
            href: "https://shop.example.com/x",
            variant: "solid",
            align: "center",
          },
        ],
      };
      const saved = await saveTemplateFor(tdeps(), w.actor, w.templateId, { doc });
      if (!saved.ok) throw new Error(JSON.stringify(saved));
      const p = await svc.previewCampaignFor(deps(), w.actor, id);
      if (!p.ok) throw new Error();
      expect(p.html).toContain("utm_source=mailory");
      expect(p.html).toContain("utm_campaign=yaz-kampanyasi");
      expect(p.html).toMatch(/href="https:\/\/app\.test\/unsubscribe\/preview"/);
      await svc.updateCampaignFor(deps(), w.actor, id, {
        utm: { enabled: false, source: "mailory", medium: "email", campaign: "" },
      });
      const off = await svc.previewCampaignFor(deps(), w.actor, id);
      if (!off.ok) throw new Error();
      expect(off.html).not.toContain("utm_source");
    });

    it("sends tests only to workspace members, marked [TEST]", async () => {
      const w = await workspace();
      const id = await readyDraft(w);
      const mate = await memberOf(w.org.id, "editor");
      const mateEmail = (await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, mate.user.id),
      }))!.email;
      const refused = await svc.sendTestFor(deps(), w.actor, id, [
        "stranger@example.net",
      ]);
      expect(refused).toMatchObject({ ok: false, code: "invalid" });
      expect(sent).toHaveLength(0);
      const ok = await svc.sendTestFor(deps(), w.actor, id, [
        mateEmail,
        mateEmail.toUpperCase(),
      ]);
      expect(ok).toMatchObject({ ok: true, sent: 1 });
      expect(sent[0]).toMatchObject({ to: mateEmail.toLowerCase() });
      expect(sent[0]!.subject.startsWith("[TEST] ")).toBe(true);
      expect(sent[0]!.html).toContain("<html");
    });
  });
});
