import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  createContact,
  createDb,
  createSenderDomain,
  organizations,
  senderDomains,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_UTM } from "@mailory/core";
import type { Actor } from "../org/service";
import { getDeliverabilityCenter } from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const NOW = new Date("2026-06-10T12:00:00Z");

suite("Deliverability Center (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const deps = () => ({ db, now: () => NOW });

  async function tenant() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const actor: Actor = {
      userId: user.id,
      organizationId: asOrganizationId(org.id),
      role: "owner",
    };
    return { user, org, oid: asOrganizationId(org.id), actor };
  }
  const ids = (r: Awaited<ReturnType<typeof getDeliverabilityCenter>>) =>
    r.ok ? r.actions.map((a) => a.id) : [];

  it("a fresh workspace is told to add a domain", async () => {
    const t = await tenant();
    const r = await getDeliverabilityCenter(deps(), t.actor);
    expect(ids(r)).toContain("no_domain");
    expect(r.ok && r.actions[0]!.severity).toBe("critical");
  });

  it("flags missing SPF/DMARC on a verified domain, and goes quiet once they are in place", async () => {
    const t = await tenant();
    const d = (await createSenderDomain(db, t.oid, {
      domain: `dc-${randomUUID().slice(0, 8)}.com`,
      provider: "mock",
      dkimTokens: ["a", "b", "c"],
      ownershipToken: "t".repeat(32),
      userId: t.user.id,
    }))!;
    await db
      .update(senderDomains)
      .set({
        status: "verified",
        dkimOk: true,
        spfState: "missing",
        dmarcState: "missing",
      })
      .where(eq(senderDomains.id, d.id));
    expect(ids(await getDeliverabilityCenter(deps(), t.actor))).toEqual(
      expect.arrayContaining([`spf_${d.id}`, `dmarc_${d.id}`]),
    );
    await db
      .update(senderDomains)
      .set({ spfState: "ok", dmarcState: "ok" })
      .where(eq(senderDomains.id, d.id));
    const r = await getDeliverabilityCenter(deps(), t.actor);
    expect(ids(r).some((x) => x.includes(d.id))).toBe(false);
  });

  async function sentCampaign(
    orgId: string,
    n: number,
    bounced: number,
    haltReason?: string,
  ) {
    const [c] = await db
      .insert(campaigns)
      .values({
        organizationId: orgId,
        name: "Geçmiş",
        status: haltReason ? "paused" : "completed",
        haltReason: haltReason ?? null,
        utm: DEFAULT_UTM,
        startedAt: new Date(NOW.getTime() - 5 * 86_400_000),
      })
      .returning();
    await db.insert(campaignRecipients).values(
      Array.from({ length: n }, (_, i) => ({
        organizationId: orgId,
        campaignId: c!.id,
        email: `r${i}-${randomUUID().slice(0, 5)}@example.org`,
        status: i < bounced ? "bounced" : "delivered",
        sentAt: new Date(NOW.getTime() - 5 * 86_400_000),
      })),
    );
    return c!;
  }

  it("raises critical actions from real bounce rates and from auto-paused campaigns, only for its own tenant", async () => {
    const a = await tenant();
    const b = await tenant();
    await sentCampaign(a.org.id, 200, 16); // 8% bounce
    const paused = await sentCampaign(a.org.id, 10, 0, "complaint_rate");
    await sentCampaign(b.org.id, 200, 0);
    const ra = await getDeliverabilityCenter(deps(), a.actor);
    expect(ids(ra)).toEqual(
      expect.arrayContaining(["bounce_critical", `paused_${paused.id}`]),
    );
    expect(ra.ok && ra.rolling).toMatchObject({ sent: 210, bounced: 16 });
    const rb = await getDeliverabilityCenter(deps(), b.actor);
    expect(ids(rb)).not.toContain("bounce_critical");
    expect(rb.ok && rb.rolling.sent).toBe(200);
  });

  it("reports list quality, missing consent and the daily-limit meter", async () => {
    const t = await tenant();
    await db
      .update(organizations)
      .set({ dailySendLimit: 100 })
      .where(eq(organizations.id, t.org.id));
    for (let i = 0; i < 4; i++)
      await createContact(db, t.oid, {
        email: `q${i}-${randomUUID().slice(0, 5)}@example.org`,
        consentStatus: i < 2 ? "granted" : "unknown",
      });
    const c = await sentCampaign(t.org.id, 90, 0);
    await db
      .update(campaignRecipients)
      .set({ sentAt: new Date(NOW.getTime() - 3600_000) })
      .where(eq(campaignRecipients.campaignId, c.id));
    const r = await getDeliverabilityCenter(deps(), t.actor);
    if (!r.ok) throw new Error();
    expect(r.lists).toMatchObject({ total: 4, subscribed: 4, noConsent: 2 });
    expect(r.limits).toEqual({ daily: 100, sentToday: 90 });
    expect(ids(r)).toEqual(expect.arrayContaining(["no_consent", "limit_near"]));
  });
});
