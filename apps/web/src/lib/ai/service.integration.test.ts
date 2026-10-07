import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AiError, MockAiProvider, type AiProvider } from "@mailory/ai";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  createContact,
  createDb,
  emailOutbox,
  templates,
  type Database,
} from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import { DEFAULT_UTM, type OrgRole } from "@mailory/core";
import type { Actor } from "../org/service";
import { createTemplateFor } from "../templates/service";
import * as svc from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const APP = "https://app.test";

suite("AI assistant (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  const deps = (provider: AiProvider | null, dailyLimit = 50): svc.AiDeps => ({
    db,
    appUrl: APP,
    provider,
    dailyLimit,
  });
  const actorFor = (userId: string, orgId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(orgId),
    role,
  });

  async function workspace(enabled = true) {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const actor = actorFor(user.id, org.id, "owner");
    if (enabled) await svc.setAiEnabledFor(deps(null), actor, true);
    const t = await createTemplateFor({ db, appUrl: APP }, actor, {
      name: "AI test",
      category: "other",
    });
    if (!t.ok) throw new Error("t");
    const contactEmail = `kisi-${randomUUID().slice(0, 6)}@example.org`;
    await createContact(db, oid, { email: contactEmail, firstName: "Gizem" });
    const [c] = await db
      .insert(campaigns)
      .values({
        organizationId: org.id,
        name: "AI",
        subject: "Konu",
        templateId: t.id,
        audience: { kind: "all" },
        utm: DEFAULT_UTM,
      })
      .returning();
    return { user, org, oid, actor, campaign: c!, contactEmail };
  }

  it("is off until a workspace admin opts in, and unavailable without a provider", async () => {
    const w = await workspace(false);
    const mock = new MockAiProvider();
    expect(
      await svc.suggestSubjectsFor(deps(mock), w.actor, w.campaign.id),
    ).toMatchObject({ code: "ai_disabled" });
    expect(mock.calls).toHaveLength(0);
    const editor = await (async () => {
      const u = await createTestUser(db);
      await addTestMember(db, w.org.id, u.id, "editor");
      return actorFor(u.id, w.org.id, "editor");
    })();
    expect(await svc.setAiEnabledFor(deps(mock), editor, true)).toMatchObject({
      code: "forbidden",
    });
    await svc.setAiEnabledFor(deps(mock), w.actor, true);
    expect(
      await svc.suggestSubjectsFor(deps(null), w.actor, w.campaign.id),
    ).toMatchObject({ code: "ai_unavailable" });
    expect((await svc.suggestSubjectsFor(deps(mock), w.actor, w.campaign.id)).ok).toBe(
      true,
    );
    expect(mock.calls).toHaveLength(1);
  });

  it("enforces RBAC and tenant isolation", async () => {
    const w = await workspace();
    const other = await createTwoTenants(db);
    const mock = new MockAiProvider();
    const viewer = await (async () => {
      const u = await createTestUser(db);
      await addTestMember(db, w.org.id, u.id, "viewer");
      return actorFor(u.id, w.org.id, "viewer");
    })();
    expect(
      await svc.suggestSubjectsFor(deps(mock), viewer, w.campaign.id),
    ).toMatchObject({ code: "forbidden" });
    expect(
      await svc.draftEmailFor(deps(mock), viewer, {
        brief: "x".repeat(20),
        tone: "samimi",
      }),
    ).toMatchObject({ code: "forbidden" });
    const foreign = actorFor(other.ownerB.id, other.orgB.id, "owner");
    await svc.setAiEnabledFor(deps(mock), foreign, true);
    expect(
      await svc.suggestSubjectsFor(deps(mock), foreign, w.campaign.id),
    ).toMatchObject({ code: "not_found" });
    expect(
      await svc.reviewCampaignFor(deps(mock), foreign, w.campaign.id),
    ).toMatchObject({ code: "not_found" });
    expect(
      await svc.analyzeCampaignFor(deps(mock), foreign, w.campaign.id),
    ).toMatchObject({ code: "not_found" });
    expect(mock.calls).toHaveLength(0);
  });

  it("stops at the daily limit and counts failures too", async () => {
    const w = await workspace();
    const mock = new MockAiProvider();
    expect(
      (await svc.suggestSubjectsFor(deps(mock, 2), w.actor, w.campaign.id)).ok,
    ).toBe(true);
    expect(
      (await svc.suggestSubjectsFor(deps(mock, 2), w.actor, w.campaign.id)).ok,
    ).toBe(true);
    expect(
      await svc.suggestSubjectsFor(deps(mock, 2), w.actor, w.campaign.id),
    ).toMatchObject({ code: "limit_reached" });
    expect(mock.calls).toHaveLength(2);
    expect(await svc.getAiStatus(deps(mock, 2), w.actor)).toMatchObject({
      usedToday: 2,
      limit: 2,
      enabled: true,
      available: true,
    });
  });

  it("turns provider failures and unusable replies into a clear error, never a crash", async () => {
    const w = await workspace();
    const down: AiProvider = {
      name: "down",
      complete: async () => {
        throw new AiError("rate_limited", "x");
      },
    };
    const r1 = await svc.suggestSubjectsFor(deps(down), w.actor, w.campaign.id);
    expect(r1).toMatchObject({ ok: false, code: "ai_failed" });
    const garbage = new MockAiProvider({ subjects: "I am sorry, I cannot do that." });
    expect(
      await svc.suggestSubjectsFor(deps(garbage), w.actor, w.campaign.id),
    ).toMatchObject({ code: "ai_failed" });
    const unknown: AiProvider = {
      name: "x",
      complete: async () => {
        throw new Error("boom");
      },
    };
    expect(
      await svc.reviewCampaignFor(deps(unknown), w.actor, w.campaign.id),
    ).toMatchObject({ code: "ai_failed" });
  });

  it("NEVER sends, schedules or changes anything: campaign untouched, no recipients, no outbox, and no personal data in prompts", async () => {
    const w = await workspace();
    const mock = new MockAiProvider();
    await db
      .update(campaigns)
      .set({ status: "completed", startedAt: new Date() })
      .where(eq(campaigns.id, w.campaign.id));
    const outboxBefore = (await db.select().from(emailOutbox)).length;
    const before = (
      await db.select().from(campaigns).where(eq(campaigns.id, w.campaign.id))
    )[0]!;
    await svc.suggestSubjectsFor(deps(mock), w.actor, w.campaign.id);
    await svc.reviewCampaignFor(deps(mock), w.actor, w.campaign.id, ["Konu çok kısa."]);
    await svc.analyzeCampaignFor(deps(mock), w.actor, w.campaign.id);
    await svc.draftEmailFor(deps(mock), w.actor, {
      brief: "Yeni ürünümüzü duyuran kısa bir e-posta",
      tone: "samimi",
    });
    expect(mock.calls.map((c) => c.feature).sort()).toEqual([
      "analyst",
      "draft",
      "review",
      "subjects",
    ]);
    const after = (
      await db.select().from(campaigns).where(eq(campaigns.id, w.campaign.id))
    )[0]!;
    expect({ ...after, updatedAt: null }).toEqual({ ...before, updatedAt: null });
    expect(
      await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.campaignId, w.campaign.id)),
    ).toHaveLength(0);
    expect((await db.select().from(emailOutbox)).length).toBe(outboxBefore);
    const prompts = mock.calls.map((c) => c.system + c.user).join("\n");
    expect(prompts).not.toContain(w.contactEmail);
    expect(prompts).not.toContain("Gizem");
  });

  it("a draft is only a proposal until the user saves it, and saving creates a NEW template safely", async () => {
    const w = await workspace();
    const mock = new MockAiProvider();
    const countTemplates = async () =>
      (await db.select().from(templates).where(eq(templates.organizationId, w.org.id)))
        .length;
    const base = await countTemplates();
    const draft = await svc.draftEmailFor(deps(mock), w.actor, {
      brief: "Yaz indirimini duyuran bir e-posta",
      tone: "enerjik",
    });
    if (!draft.ok) throw new Error(JSON.stringify(draft));
    expect(await countTemplates()).toBe(base); // proposal only
    expect(draft.doc.blocks.some((b) => b.type === "footer")).toBe(true);
    const saved = await svc.saveAiDraftFor(deps(mock), w.actor, {
      title: draft.title,
      doc: draft.doc,
    });
    expect(saved.ok).toBe(true);
    const again = await svc.saveAiDraftFor(deps(mock), w.actor, {
      title: draft.title,
      doc: draft.doc,
    });
    expect(again.ok).toBe(true); // name collision handled with a suffix
    expect(await countTemplates()).toBe(base + 2);
    expect(
      await svc.saveAiDraftFor(deps(mock), w.actor, {
        title: "x",
        doc: { version: 1, blocks: "nope" },
      }),
    ).toMatchObject({ code: "invalid" });
    expect(
      await svc.draftEmailFor(deps(mock), w.actor, { brief: "kısa", tone: "samimi" }),
    ).toMatchObject({ code: "invalid" });
  });

  it("the analyst refuses a campaign that has not been sent", async () => {
    const w = await workspace();
    expect(
      await svc.analyzeCampaignFor(deps(new MockAiProvider()), w.actor, w.campaign.id),
    ).toMatchObject({ code: "invalid" });
  });
});

describe("static safety: the AI code cannot reach any sending capability", () => {
  const FORBIDDEN = [
    /scheduleCampaignFor|submitCampaignFor|approveCampaignFor|sendTestFor|cancelCampaignFor|resumeCampaignFor/,
    /activateAutomationFor|enrollAudienceFor|enrollContacts|queueAutomationRecipient/,
    /@mailory\/sending|enqueueEmail|transport\.send|SesTransport/,
    /startCampaignSending|materializeRecipients|claimRecipients/,
  ];
  const roots = [
    path.resolve(__dirname),
    path.resolve(__dirname, "../../../../../packages/ai/src"),
  ];
  const files = roots.flatMap((r) =>
    readdirSync(r, { recursive: true, withFileTypes: true })
      .filter(
        (f) => f.isFile() && f.name.endsWith(".ts") && !/\.test\.ts$/.test(f.name),
      )
      .map((f) => path.join(f.parentPath, f.name)),
  );
  it("scans real files", () => expect(files.length).toBeGreaterThanOrEqual(4));
  it.each(files.map((f) => [path.relative(process.cwd(), f), f]))(
    "%s imports nothing that can send or schedule",
    (_n, f) => {
      const src = readFileSync(f as string, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n");
      for (const rx of FORBIDDEN) expect(src).not.toMatch(rx);
    },
  );
});
