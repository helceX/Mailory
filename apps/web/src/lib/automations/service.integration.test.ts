import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaigns,
  createContact,
  createDb,
  createList,
  createSenderDomain,
  createSenderIdentity,
  organizations,
  senderDomains,
  tags,
  type Database,
} from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import type { OrgRole, Step } from "@mailory/core";
import type { Actor } from "../org/service";
import {
  createTemplateFor,
  getTemplateFor,
  saveTemplateFor,
} from "../templates/service";
import * as svc from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const APP = "https://app.test";

suite("automation service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const deps = () => ({ db, appUrl: APP });
  const actorFor = (userId: string, orgId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(orgId),
    role,
  });
  async function memberOf(orgId: string, role: OrgRole) {
    const u = await createTestUser(db);
    await addTestMember(db, orgId, u.id, role);
    return actorFor(u.id, orgId, role);
  }

  async function workspace() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const actor = actorFor(user.id, org.id, "owner");
    const domain = `auto-${randomUUID().slice(0, 8)}.com`;
    const d = (await createSenderDomain(db, oid, {
      domain,
      provider: "mock",
      dkimTokens: ["a", "b", "c"],
      ownershipToken: "t".repeat(32),
      userId: user.id,
    }))!;
    await db
      .update(senderDomains)
      .set({ status: "verified" })
      .where(eq(senderDomains.id, d.id));
    const identity = (await createSenderIdentity(db, oid, {
      fromName: "Acme",
      fromEmail: `info@${domain}`,
      replyTo: null,
      userId: user.id,
    }))!;
    const t = await createTemplateFor({ db, appUrl: APP }, actor, {
      name: "Karşılama",
      category: "other",
    });
    if (!t.ok) throw new Error("template");
    const list = (await createList(db, oid, { name: "L", description: null }))!;
    const [tag] = await db
      .insert(tags)
      .values({ organizationId: org.id, name: "T" })
      .returning();
    const email = (id: string): Step => ({
      id,
      type: "email",
      templateId: t.id,
      senderIdentityId: identity.id,
      subject: `Konu ${id}`,
    });
    return {
      user,
      org,
      oid,
      actor,
      identity,
      templateId: t.id,
      list,
      tag: tag!,
      email,
      domain,
    };
  }
  const validSteps = (w: Awaited<ReturnType<typeof workspace>>): Step[] => [
    w.email("a"),
    { id: "w", type: "wait", amount: 1, unit: "days" },
    w.email("b"),
  ];
  async function draft(w: Awaited<ReturnType<typeof workspace>>, steps?: Step[]) {
    const c = await svc.createAutomationFor(deps(), w.actor, {
      name: "Seri",
      trigger: { type: "contact_created" },
    });
    if (!c.ok) throw new Error("create");
    const u = await svc.updateAutomationFor(deps(), w.actor, c.id, {
      steps: steps ?? validSteps(w),
    });
    if (!u.ok) throw new Error(`update ${u.code} ${u.message}`);
    return c.id;
  }

  it("RBAC: viewers read; editors write; activation needs send; approval policy needs an approver", async () => {
    const w = await workspace();
    const viewer = await memberOf(w.org.id, "viewer");
    const editor = await memberOf(w.org.id, "editor");
    const id = await draft(w);
    expect((await svc.listAutomationsFor(deps(), viewer)).ok).toBe(true);
    expect(
      await svc.createAutomationFor(deps(), viewer, {
        name: "x",
        trigger: { type: "manual" },
      }),
    ).toMatchObject({ code: "forbidden" });
    expect(await svc.activateAutomationFor(deps(), viewer, id)).toMatchObject({
      code: "forbidden",
    });
    await db
      .update(organizations)
      .set({ requireCampaignApproval: true })
      .where(eq(organizations.id, w.org.id));
    expect(await svc.activateAutomationFor(deps(), editor, id)).toMatchObject({
      code: "approval_required",
    });
    expect((await svc.activateAutomationFor(deps(), w.actor, id)).ok).toBe(true);
  });

  it("every operation treats another tenant's automation as missing", async () => {
    const { ownerA, orgA, ownerB, orgB } = await createTwoTenants(db);
    const a = actorFor(ownerA.id, orgA.id, "owner");
    const b = actorFor(ownerB.id, orgB.id, "owner");
    const c = await svc.createAutomationFor(deps(), a, {
      name: "Gizli",
      trigger: { type: "manual" },
    });
    if (!c.ok) throw new Error();
    for (const r of [
      await svc.getAutomationFor(deps(), b, c.id),
      await svc.updateAutomationFor(deps(), b, c.id, { name: "x" }),
      await svc.deleteAutomationFor(deps(), b, c.id),
      await svc.duplicateAutomationFor(deps(), b, c.id),
      await svc.activateAutomationFor(deps(), b, c.id),
      await svc.pauseAutomationFor(deps(), b, c.id),
      await svc.resumeAutomationFor(deps(), b, c.id),
      await svc.archiveAutomationFor(deps(), b, c.id),
      await svc.enrollAudienceFor(deps(), b, c.id, { kind: "all" }),
    ])
      expect(r).toMatchObject({ ok: false, code: "not_found" });
    const list = await svc.listAutomationsFor(deps(), b);
    expect(list.ok && list.automations).toEqual([]);
  });

  it("rejects references to another tenant's template, sender, list or tag", async () => {
    const a = await workspace();
    const b = await workspace();
    const id = await draft(a);
    const foreignEmail: Step = {
      id: "f",
      type: "email",
      templateId: b.templateId,
      senderIdentityId: a.identity.id,
      subject: "x",
    };
    expect(
      await svc.updateAutomationFor(deps(), a.actor, id, { steps: [foreignEmail] }),
    ).toMatchObject({ code: "invalid" });
    const foreignSender: Step = {
      id: "f",
      type: "email",
      templateId: a.templateId,
      senderIdentityId: b.identity.id,
      subject: "x",
    };
    expect(
      await svc.updateAutomationFor(deps(), a.actor, id, { steps: [foreignSender] }),
    ).toMatchObject({ code: "invalid" });
    expect(
      await svc.updateAutomationFor(deps(), a.actor, id, {
        trigger: { type: "list_joined", listId: b.list.id },
      }),
    ).toMatchObject({ code: "invalid" });
    expect(
      await svc.updateAutomationFor(deps(), a.actor, id, {
        trigger: { type: "tag_added", tagId: b.tag.id },
      }),
    ).toMatchObject({ code: "invalid" });
    expect(
      await svc.updateAutomationFor(deps(), a.actor, id, {
        steps: [
          {
            id: "c",
            type: "condition",
            check: { kind: "has_tag", tagId: b.tag.id },
            yes: [a.email("y")],
            no: [],
          },
        ],
      }),
    ).toMatchObject({ code: "invalid" });
  });

  it("a draft can be incomplete but never structurally unsafe; going live needs everything", async () => {
    const w = await workspace();
    const id = await draft(w, [w.email("a")]); // one email only: fine as a draft…
    expect(
      await svc.updateAutomationFor(deps(), w.actor, id, {
        steps: [w.email("a"), w.email("a")],
      }),
    ).toMatchObject({ code: "invalid" });
    const noSteps = await svc.createAutomationFor(deps(), w.actor, {
      name: "Boş",
      trigger: { type: "manual" },
    });
    if (!noSteps.ok) throw new Error();
    expect(await svc.activateAutomationFor(deps(), w.actor, noSteps.id)).toMatchObject({
      code: "not_ready",
    });
    // unverified sender blocks activation
    await db
      .update(senderDomains)
      .set({ status: "failed" })
      .where(eq(senderDomains.organizationId, w.org.id));
    expect(await svc.activateAutomationFor(deps(), w.actor, id)).toMatchObject({
      code: "not_ready",
    });
  });

  it("activation freezes content into hidden step campaigns; later template edits change nothing; structure is locked", async () => {
    const w = await workspace();
    const id = await draft(w);
    expect((await svc.activateAutomationFor(deps(), w.actor, id)).ok).toBe(true);
    const steps = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.automationId, id));
    expect(steps.map((c) => c.automationStepId).sort()).toEqual(["a", "b"]);
    expect(
      steps.every(
        (c) => c.kind === "automation_step" && c.status === "sending" && c.snapshot,
      ),
    ).toBe(true);
    const before = JSON.stringify(steps[0]!.snapshot);
    const t = await getTemplateFor({ db, appUrl: APP }, w.actor, w.templateId);
    if (!t.ok) throw new Error();
    await saveTemplateFor({ db, appUrl: APP }, w.actor, w.templateId, {
      doc: { ...t.doc, blocks: [] },
    });
    const after = (
      await db.select().from(campaigns).where(eq(campaigns.id, steps[0]!.id))
    )[0]!;
    expect(JSON.stringify(after.snapshot)).toBe(before);
    expect(
      await svc.updateAutomationFor(deps(), w.actor, id, { name: "yeni" }),
    ).toMatchObject({ code: "conflict" });
    expect(await svc.deleteAutomationFor(deps(), w.actor, id)).toMatchObject({
      code: "conflict",
    });
    expect(await svc.activateAutomationFor(deps(), w.actor, id)).toMatchObject({
      code: "conflict",
    });
    // hidden campaigns never appear in the campaign list nor can be opened as campaigns
    const { listCampaignsFor, getCampaignFor } = await import("../campaigns/service");
    const cdeps = { db, appUrl: APP, sendTest: async () => {} };
    const list = await listCampaignsFor(cdeps, w.actor);
    expect(list.ok && list.campaigns.some((c) => c.automationId === id)).toBe(false);
    expect(await getCampaignFor(cdeps, w.actor, steps[0]!.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("pause, resume and archive follow the lifecycle; archive ends running enrolments; copies start as drafts", async () => {
    const w = await workspace();
    const id = await draft(w);
    expect(await svc.pauseAutomationFor(deps(), w.actor, id)).toMatchObject({
      code: "conflict",
    });
    await svc.activateAutomationFor(deps(), w.actor, id);
    expect((await svc.pauseAutomationFor(deps(), w.actor, id)).ok).toBe(true);
    expect(await svc.pauseAutomationFor(deps(), w.actor, id)).toMatchObject({
      code: "conflict",
    });
    expect((await svc.resumeAutomationFor(deps(), w.actor, id)).ok).toBe(true);
    const copy = await svc.duplicateAutomationFor(deps(), w.actor, id);
    if (!copy.ok) throw new Error();
    const got = await svc.getAutomationFor(deps(), w.actor, copy.id);
    expect(got.ok && got.automation.status).toBe("draft");
    expect(got.ok && (got.automation.steps as Step[]).length).toBe(3);
    expect((await svc.archiveAutomationFor(deps(), w.actor, id)).ok).toBe(true);
    expect(await svc.resumeAutomationFor(deps(), w.actor, id)).toMatchObject({
      code: "conflict",
    });
  });

  it("manual enrolment only works on a running manual automation", async () => {
    const w = await workspace();
    for (let i = 0; i < 3; i++)
      await createContact(db, w.oid, {
        email: `m${i}-${randomUUID().slice(0, 5)}@example.org`,
      });
    const auto = await svc.createAutomationFor(deps(), w.actor, {
      name: "Elle",
      trigger: { type: "manual" },
    });
    if (!auto.ok) throw new Error();
    await svc.updateAutomationFor(deps(), w.actor, auto.id, { steps: validSteps(w) });
    expect(
      await svc.enrollAudienceFor(deps(), w.actor, auto.id, { kind: "all" }),
    ).toMatchObject({ code: "conflict" }); // not running
    await svc.activateAutomationFor(deps(), w.actor, auto.id);
    const r = await svc.enrollAudienceFor(deps(), w.actor, auto.id, { kind: "all" });
    expect(r).toMatchObject({ ok: true, enrolled: 3 });
    expect(
      await svc.enrollAudienceFor(deps(), w.actor, auto.id, { kind: "all" }),
    ).toMatchObject({ enrolled: 0 });
    const auto2 = await draft(w);
    await svc.activateAutomationFor(deps(), w.actor, auto2); // contact_created trigger
    expect(
      await svc.enrollAudienceFor(deps(), w.actor, auto2, { kind: "all" }),
    ).toMatchObject({ code: "conflict" });
  });
});
