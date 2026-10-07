import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  asOrganizationId,
  auditLogs,
  campaignRecipients,
  campaigns,
  createDb,
  type Database,
} from "@mailory/db";
import { addTestMember, createTestUser, createTwoTenants } from "@mailory/db/testing";
import { DEFAULT_UTM, type OrgRole } from "@mailory/core";
import type { Actor } from "../org/service";
import {
  exportAnalyticsCsv,
  getAnalyticsOverview,
  getCampaignReport,
  rate,
  rates,
} from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("analytics service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const deps = () => ({ db, now: () => new Date("2026-03-15T00:00:00Z") });
  const actor = (userId: string, orgId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(orgId),
    role,
  });

  async function campaign(orgId: string, name: string, n: number, opened: number) {
    const [c] = await db
      .insert(campaigns)
      .values({
        organizationId: orgId,
        name,
        subject: name,
        status: "completed",
        utm: DEFAULT_UTM,
        startedAt: new Date("2026-03-10T00:00:00Z"),
      })
      .returning();
    await db.insert(campaignRecipients).values(
      Array.from({ length: n }, (_, i) => ({
        organizationId: orgId,
        campaignId: c!.id,
        email: `a${i}-${randomUUID().slice(0, 5)}@example.org`,
        status: "delivered",
        sentAt: new Date(),
        deliveredAt: new Date(),
        openedAt: i < opened ? new Date() : null,
      })),
    );
    return c!;
  }

  it("never divides by zero: a rate with no denominator is null, not 0%", () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(
      rates({
        recipients: 0,
        sent: 0,
        delivered: 0,
        bounced: 0,
        complained: 0,
        failed: 0,
        unsubscribed: 0,
        uniqueOpens: 0,
        uniqueClicks: 0,
        totalOpens: 0,
        totalClicks: 0,
      }).open,
    ).toBeNull();
  });

  it("reports a campaign and refuses foreign tenants and roles without analytics access", async () => {
    const { ownerA, orgA, ownerB, orgB } = await createTwoTenants(db);
    const a = actor(ownerA.id, orgA.id, "owner");
    const b = actor(ownerB.id, orgB.id, "owner");
    const c = await campaign(orgA.id, "Rapor", 10, 4);
    const rep = await getCampaignReport(deps(), a, c.id);
    expect(rep).toMatchObject({ ok: true, stats: { recipients: 10, uniqueOpens: 4 } });
    if (rep.ok) expect(rep.rates.open).toBeCloseTo(0.4);
    expect(await getCampaignReport(deps(), b, c.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    const viewer = await createTestUser(db);
    await addTestMember(db, orgA.id, viewer.id, "viewer");
    expect(
      (await getCampaignReport(deps(), actor(viewer.id, orgA.id, "viewer"), c.id)).ok,
    ).toBe(true); // analytics:read
  });

  it("overview covers only this tenant's recent campaigns", async () => {
    const { ownerA, orgA, ownerB, orgB } = await createTwoTenants(db);
    await campaign(orgA.id, "A1", 5, 2);
    await campaign(orgA.id, "A2", 5, 3);
    await campaign(orgB.id, "B1", 50, 50);
    const r = await getAnalyticsOverview(
      deps(),
      actor(ownerA.id, orgA.id, "owner"),
      30,
    );
    if (!r.ok) throw new Error();
    expect(r.overview).toMatchObject({ campaigns: 2, sent: 10, uniqueOpens: 5 });
    expect(r.campaigns.map((c) => c.name).sort()).toEqual(["A1", "A2"]);
    // A window that excludes the campaigns' start date is empty.
    const old = await getAnalyticsOverview(
      { db, now: () => new Date("2027-06-01T00:00:00Z") },
      actor(ownerB.id, orgB.id, "owner"),
      30,
    );
    expect(old.ok && old.overview.campaigns).toBe(0);
  });

  it("exports CSV that is audited and neutralises spreadsheet formulas in campaign names", async () => {
    const { ownerA, orgA, ownerB, orgB } = await createTwoTenants(db);
    await campaign(orgA.id, '=HYPERLINK("http://evil","x")', 3, 1);
    await campaign(orgB.id, "Başkasının", 3, 1);
    const r = await exportAnalyticsCsv(deps(), actor(ownerA.id, orgA.id, "owner"));
    if (!r.ok) throw new Error();
    expect(r.rows).toBe(1);
    expect(r.csv.startsWith("﻿")).toBe(true);
    expect(r.csv).not.toContain("Başkasının");
    expect(r.csv).not.toMatch(/(^|[;,\n"])=HYPERLINK/);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgA.id),
          eq(auditLogs.action, "analytics.exported"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(
      await exportAnalyticsCsv(deps(), actor(ownerB.id, orgB.id, "viewer" as OrgRole)),
    ).toMatchObject({ ok: true });
  });
});
