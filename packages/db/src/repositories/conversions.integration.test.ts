import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DEFAULT_UTM } from "@mailory/core";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  contacts,
  conversionStats,
  conversions,
  createDb,
  eraseContact,
  exportContactData,
  recordConversion,
  senderIdentities,
  templateVersions,
  templates,
  type Database,
} from "../index";
import { createTestOrg, createTestUser } from "../testing";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const DAY = 86_400_000;
const T = new Date("2026-06-15T12:00:00Z");

suite("conversion tracking and attribution (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function world() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const o = org.id;
    const [identity] = await db
      .insert(senderIdentities)
      .values({
        organizationId: o,
        fromName: "A",
        fromEmail: `i-${randomUUID().slice(0, 6)}@example.org`,
      })
      .returning();
    const [tpl] = await db
      .insert(templates)
      .values({ organizationId: o, name: "T", category: "other" })
      .returning();
    const [ver] = await db
      .insert(templateVersions)
      .values({
        templateId: tpl!.id,
        organizationId: o,
        version: Math.floor(Math.random() * 1e6) + 1,
        doc: {},
      })
      .returning();
    const email = `p-${randomUUID().slice(0, 6)}@example.org`;
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: o, email })
      .returning();
    const campaign = async (name: string) =>
      (
        await db
          .insert(campaigns)
          .values({
            organizationId: o,
            name,
            status: "completed",
            subject: name,
            utm: DEFAULT_UTM,
            senderIdentityId: identity!.id,
            templateId: tpl!.id,
            templateVersionId: ver!.id,
          })
          .returning()
      )[0]!;
    const send = async (
      c: { id: string },
      daysBefore: number,
      clickedDaysBefore?: number,
    ) =>
      (
        await db
          .insert(campaignRecipients)
          .values({
            organizationId: o,
            campaignId: c.id,
            contactId: contact!.id,
            email,
            status: "sent",
            sentAt: new Date(T.getTime() - daysBefore * DAY),
            clickedAt:
              clickedDaysBefore === undefined
                ? null
                : new Date(T.getTime() - clickedDaysBefore * DAY),
          })
          .returning()
      )[0]!;
    return { oid: asOrganizationId(o), email, contact: contact!, campaign, send };
  }
  const conv = (over: Partial<Parameters<typeof recordConversion>[2]> = {}) => ({
    name: "purchase",
    email: null,
    contactId: null,
    value: 100,
    currency: "TRY",
    occurredAt: T,
    externalId: null,
    ...over,
  });

  it("attributes to the latest SENT email when nothing was clicked", async () => {
    const w = await world();
    const a = await w.campaign("A");
    const b = await w.campaign("B");
    await w.send(a, 10);
    await w.send(b, 3);
    const r = await recordConversion(db, w.oid, conv({ email: w.email }));
    expect(r).toMatchObject({ created: true, campaignId: b.id, attribution: "send" });
  });

  it("prefers a campaign the person CLICKED over a later one they only received", async () => {
    const w = await world();
    const a = await w.campaign("A");
    const b = await w.campaign("B");
    await w.send(a, 10, 9); // clicked
    await w.send(b, 2); // newer, not clicked
    const r = await recordConversion(db, w.oid, conv({ email: w.email }));
    expect(r).toMatchObject({ campaignId: a.id, attribution: "click" });
  });

  it("among several clicks, takes the most recent one", async () => {
    const w = await world();
    const a = await w.campaign("A");
    const b = await w.campaign("B");
    await w.send(a, 20, 19);
    await w.send(b, 8, 7);
    expect(
      (await recordConversion(db, w.oid, conv({ contactId: w.contact.id }))).campaignId,
    ).toBe(b.id);
  });

  it("ignores emails outside the 30-day window and ones sent after the conversion", async () => {
    const w = await world();
    const old = await w.campaign("Old");
    const future = await w.campaign("Future");
    await w.send(old, 45);
    await w.send(future, -2); // sent two days AFTER T
    const r = await recordConversion(db, w.oid, conv({ email: w.email }));
    expect(r).toMatchObject({ campaignId: null, attribution: null });
  });

  it("a click that happened AFTER the conversion does not count as a click", async () => {
    const w = await world();
    const a = await w.campaign("A");
    await w.send(a, 5, -1); // clicked one day after T
    expect(await recordConversion(db, w.oid, conv({ email: w.email }))).toMatchObject({
      campaignId: a.id,
      attribution: "send",
    });
  });

  it("stores outcomes for unknown people without attributing them", async () => {
    const w = await world();
    const r = await recordConversion(
      db,
      w.oid,
      conv({ email: "stranger@example.org" }),
    );
    expect(r).toMatchObject({ created: true, campaignId: null, attribution: null });
  });

  it("is idempotent per externalId", async () => {
    const w = await world();
    const a = await w.campaign("A");
    await w.send(a, 2);
    const first = await recordConversion(
      db,
      w.oid,
      conv({ email: w.email, externalId: "order-1" }),
    );
    const second = await recordConversion(
      db,
      w.oid,
      conv({ email: w.email, externalId: "order-1", value: 999 }),
    );
    expect(second).toMatchObject({ id: first.id, created: false, campaignId: a.id });
    const stats = await conversionStats(db, w.oid, a.id);
    expect(stats).toMatchObject({ total: 1, people: 1, revenue: 100 });
    // Concurrent retries still produce a single row.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordConversion(db, w.oid, conv({ email: w.email, externalId: "order-2" })),
      ),
    );
    expect(new Set(results.map((x) => x.id)).size).toBe(1);
  });

  it("never attributes across tenants", async () => {
    const a = await world();
    const b = await world();
    const ca = await a.campaign("A");
    await a.send(ca, 2);
    // Same person in another workspace: b's conversion cannot see a's sends.
    const r = await recordConversion(db, b.oid, conv({ email: a.email }));
    expect(r.campaignId).toBeNull();
    expect((await conversionStats(db, b.oid, ca.id)).total).toBe(0);
  });

  it("aggregates by name with value and click share", async () => {
    const w = await world();
    const a = await w.campaign("A");
    await w.send(a, 4, 3);
    await recordConversion(
      db,
      w.oid,
      conv({ email: w.email, name: "purchase", value: 250.5 }),
    );
    await recordConversion(
      db,
      w.oid,
      conv({ email: w.email, name: "purchase", value: 100 }),
    );
    await recordConversion(
      db,
      w.oid,
      conv({ email: w.email, name: "signup", value: 0 }),
    );
    const s = await conversionStats(db, w.oid, a.id);
    expect(s).toMatchObject({ total: 3, people: 1, revenue: 350.5, viaClick: 3 });
    expect(s.byName[0]).toMatchObject({ name: "purchase", count: 2, value: 350.5 });
  });

  it("KVKK: erasing a contact anonymizes their outcomes but keeps campaign totals; export includes them", async () => {
    const w = await world();
    const a = await w.campaign("A");
    await w.send(a, 2, 1);
    await recordConversion(db, w.oid, conv({ email: w.email, value: 75 }));
    const exported = await exportContactData(db, w.oid, w.contact.id);
    expect(exported?.outcomes).toMatchObject([
      { name: "purchase", value: 75, attribution: "click" },
    ]);
    await eraseContact(db, w.oid, w.contact.id);
    const rows = await db
      .select()
      .from(conversions)
      .where(eq(conversions.organizationId, w.oid));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toMatch(/@erased\.invalid$/);
    expect(rows[0]!.contactId).toBeNull();
    expect((await conversionStats(db, w.oid, a.id)).revenue).toBe(75);
  });
});
