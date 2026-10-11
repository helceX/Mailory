import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOrganizationId,
  createDb,
  conversions,
  outcomeSignals,
  type Database,
  senderDomains,
  senderIdentities,
  contacts,
  campaigns,
} from "@mailory/db";
import { DEFAULT_UTM } from "@mailory/core";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { getGrowthOverview } from "./growth";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const now = new Date("2026-10-11T12:00:00Z");
suite("growth evidence and next actions (real Postgres)", () => {
  let db: Database, end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(process.env.DATABASE_URL!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  async function world() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    return {
      userId: user.id,
      organizationId: asOrganizationId(org.id),
      role: "owner" as const,
    };
  }
  it("uses ingestion time, scopes tenants and excludes old or future receipt timestamps", async () => {
    const a = await world(),
      b = await world();
    await db.insert(conversions).values([
      {
        organizationId: a.organizationId,
        name: "demo_request",
        email: "one@example.org",
        occurredAt: new Date("2026-01-01"),
        createdAt: now,
      },
      {
        organizationId: a.organizationId,
        name: "demo_request",
        email: "one@example.org",
        occurredAt: now,
        createdAt: now,
      },
      {
        organizationId: a.organizationId,
        name: "old",
        occurredAt: now,
        createdAt: new Date("2026-09-01"),
      },
      {
        organizationId: a.organizationId,
        name: "future",
        occurredAt: now,
        createdAt: new Date("2026-11-01"),
      },
      {
        organizationId: b.organizationId,
        name: "purchase",
        occurredAt: now,
        createdAt: now,
      },
    ]);
    expect(await outcomeSignals(db, a.organizationId, now)).toEqual([
      { name: "demo_request", received: 2, people: 1, lastReceived: now.toISOString() },
    ]);
    const overview = await getGrowthOverview({ db, now: () => now }, a);
    if (!overview.ok) throw new Error("overview");
    expect(overview.measurement.title).toBe("Sonuç olayları alınıyor");
    expect(overview.action.href).toBe("/settings/domains");
    expect(overview.experiments).toEqual([]);
  });
  it("treats missing outcomes as missing evidence and gives viewers a read-only next step", async () => {
    const a = await world();
    const overview = await getGrowthOverview(
      { db, now: () => now },
      { ...a, role: "viewer" },
    );
    if (!overview.ok) throw new Error("overview");
    expect(overview.signals).toEqual([]);
    expect(overview.measurement.title).toBe("Sonuç verisi henüz gelmiyor");
    expect(overview.action.href).toBe("/campaigns");
    expect(overview.sendable).toBe(0);
  });
  it("progresses through sender and eligible audience setup, then prioritizes an older active measurement over a newer finished one", async () => {
    const a = await world();
    const get = async () => {
      const r = await getGrowthOverview({ db, now: () => now }, a);
      if (!r.ok) throw new Error("overview");
      return r;
    };
    await db.insert(senderDomains).values({
      organizationId: a.organizationId,
      domain: `growth-${a.organizationId}.test`,
      provider: "mock",
      status: "verified",
      ownershipToken: "t".repeat(32),
      dkimTokens: ["a", "b", "c"],
    });
    expect((await get()).action.href).toBe("/settings/senders");
    await db.insert(senderIdentities).values({
      organizationId: a.organizationId,
      fromName: "Growth",
      fromEmail: "growth@example.org",
    });
    await db.insert(contacts).values({
      organizationId: a.organizationId,
      email: "unsub@example.org",
      status: "unsubscribed",
    });
    expect((await get()).action.href).toBe("/audience/contacts/import");
    await db.insert(contacts).values({
      organizationId: a.organizationId,
      email: "sub@example.org",
      status: "subscribed",
    });
    expect((await get()).action.href).toBe("/campaigns?playbook=demo");
    const [draft] = await db
      .insert(campaigns)
      .values({ organizationId: a.organizationId, name: "Draft", utm: DEFAULT_UTM })
      .returning();
    expect((await get()).action.href).toBe(`/campaigns/${draft!.id}`);
    const [active] = await db
      .insert(campaigns)
      .values({
        organizationId: a.organizationId,
        name: "Active",
        utm: DEFAULT_UTM,
        status: "completed",
        startedAt: new Date(now.getTime() - 10 * 86400000),
        audience: {
          kind: "all",
          impact: { goal: "purchase", controlPercent: 50, windowDays: 30 },
        },
      })
      .returning();
    await db.insert(campaigns).values({
      organizationId: a.organizationId,
      name: "Recent finished",
      utm: DEFAULT_UTM,
      status: "completed",
      startedAt: new Date(now.getTime() - 8 * 86400000),
      audience: {
        kind: "all",
        impact: { goal: "purchase", controlPercent: 50, windowDays: 7 },
      },
    });
    expect((await get()).action.href).toBe(`/campaigns/${active!.id}`);
  });
});
