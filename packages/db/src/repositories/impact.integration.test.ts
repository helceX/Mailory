import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { DEFAULT_UTM } from "@mailory/core";
import {
  createDb,
  createContact,
  createCampaign,
  asOrganizationId,
  campaignImpactMembers,
  campaignRecipients,
  campaigns,
  materializeRecipients,
  startCampaignSending,
  recordConversion,
  campaignImpactReport,
  eraseContact,
  exportContactData,
  type Database,
} from "../index";
import { createTwoTenants } from "../testing";
const url = process.env.DATABASE_URL;
(url ? describe : describe.skip)("impact cohorts (real Postgres)", () => {
  let db: Database, end: () => Promise<void>;
  const start = new Date("2026-10-11T12:00:00Z"),
    during = new Date("2026-10-12T12:00:00Z"),
    after = new Date("2026-10-20T12:00:00Z");
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(() => end());
  async function fixture() {
    const t = await createTwoTenants(db),
      org = asOrganizationId(t.orgA.id);
    for (let i = 0; i < 10; i++)
      await createContact(db, org, { email: `${randomUUID()}@example.org` });
    const c = await createCampaign(db, org, {
      name: "Impact",
      utm: DEFAULT_UTM,
      createdByUserId: t.ownerA.id,
      audience: {
        kind: "all",
        impact: { goal: "purchase", controlPercent: 20, windowDays: 7 },
      },
    });
    await db
      .update(campaigns)
      .set({ status: "completed", startedAt: start })
      .where(eq(campaigns.id, c.id));
    return { ...t, org, c };
  }
  it("freezes exact groups transactionally, survives concurrent retries and never expands after assignment", async () => {
    const f = await fixture();
    expect(
      (
        await Promise.all([
          materializeRecipients(db, f.org, f.c.id, {}, start),
          materializeRecipients(db, f.org, f.c.id, {}, start),
        ])
      ).sort(),
    ).toEqual([0, 8]);
    await createContact(db, f.org, { email: `${randomUUID()}@example.org` });
    expect(await materializeRecipients(db, f.org, f.c.id, {}, during)).toBe(0);
    const assigned = await db
      .select()
      .from(campaignImpactMembers)
      .where(eq(campaignImpactMembers.campaignId, f.c.id));
    expect(assigned).toHaveLength(10);
    expect(assigned.filter((m) => m.arm === "control")).toHaveLength(2);
    const queued = await db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, f.c.id));
    expect(queued.map((r) => r.email).sort()).toEqual(
      assigned
        .filter((m) => m.arm === "treatment")
        .map((m) => m.email)
        .sort(),
    );
    expect(
      await campaignImpactReport(db, asOrganizationId(f.orgB.id), f.c.id, after),
    ).toBeNull();
  });
  it("rolls status, groups and recipients back together if preparation fails", async () => {
    const f = await fixture();
    await db
      .update(campaigns)
      .set({ status: "scheduled", startedAt: null })
      .where(eq(campaigns.id, f.c.id));
    await expect(
      db.transaction(async (tx) => {
        await startCampaignSending(tx, f.org, f.c.id, start);
        await materializeRecipients(tx, f.org, f.c.id, {}, start);
        throw new Error("simulated preparation failure");
      }),
    ).rejects.toThrow("simulated preparation failure");
    expect(
      (await db.select().from(campaigns).where(eq(campaigns.id, f.c.id)))[0],
    ).toMatchObject({ status: "scheduled", startedAt: null });
    expect(
      await db
        .select()
        .from(campaignImpactMembers)
        .where(eq(campaignImpactMembers.campaignId, f.c.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.campaignId, f.c.id)),
    ).toHaveLength(0);
    expect(await materializeRecipients(db, f.org, f.c.id, {}, start)).toBe(8);
  });
  it("counts unattributed control outcomes, deduplicates people and excludes wrong goals/time/tenants", async () => {
    const f = await fixture();
    await materializeRecipients(db, f.org, f.c.id, {}, start);
    const rows = await db
      .select()
      .from(campaignImpactMembers)
      .where(eq(campaignImpactMembers.campaignId, f.c.id));
    const control = rows.find((r) => r.arm === "control")!;
    const conversion = {
      name: "purchase",
      email: control.email,
      contactId: control.contactId,
      value: 10,
      currency: "TRY",
      occurredAt: during,
      externalId: randomUUID(),
    };
    expect(await recordConversion(db, f.org, conversion)).toMatchObject({
      attribution: null,
      campaignId: null,
    });
    await recordConversion(db, f.org, { ...conversion, externalId: randomUUID() });
    await recordConversion(db, f.org, {
      ...conversion,
      name: "demo",
      externalId: randomUUID(),
    });
    const treatment = rows.find((r) => r.arm === "treatment")!;
    await recordConversion(db, f.org, {
      ...conversion,
      email: treatment.email,
      contactId: treatment.contactId,
      occurredAt: new Date(start.getTime() - 1),
      externalId: randomUUID(),
    });
    await recordConversion(db, f.org, {
      ...conversion,
      email: treatment.email,
      contactId: treatment.contactId,
      occurredAt: after,
      externalId: randomUUID(),
    });
    await recordConversion(db, asOrganizationId(f.orgB.id), {
      ...conversion,
      contactId: null,
      externalId: randomUUID(),
    });
    expect(await campaignImpactReport(db, f.org, f.c.id, after)).toMatchObject({
      control: { assigned: 2, converted: 1 },
      treatment: { assigned: 8, converted: 0 },
      status: "insufficient",
    });
    expect(
      (await exportContactData(db, f.org, control.contactId!))?.impactAssignments,
    ).toHaveLength(1);
    await eraseContact(db, f.org, control.contactId!);
    expect(await campaignImpactReport(db, f.org, f.c.id, after)).toMatchObject({
      control: { erased: 1 },
      status: "compromised",
    });
    const erased = await db
      .select()
      .from(campaignImpactMembers)
      .where(eq(campaignImpactMembers.id, control.id));
    expect(erased[0]!.email).not.toBe(control.email);
  });
  it("flags contamination from another campaign rather than deleting exposed controls", async () => {
    const f = await fixture();
    await materializeRecipients(db, f.org, f.c.id, {}, start);
    const member = (
      await db
        .select()
        .from(campaignImpactMembers)
        .where(eq(campaignImpactMembers.campaignId, f.c.id))
    )[0]!;
    const other = await createCampaign(db, f.org, {
      name: "Other",
      utm: DEFAULT_UTM,
      createdByUserId: null,
    });
    await db
      .insert(campaignRecipients)
      .values({
        organizationId: f.org,
        campaignId: other.id,
        contactId: member.contactId,
        email: member.email,
        status: "sent",
        sentAt: during,
      });
    const r = await campaignImpactReport(db, f.org, f.c.id, after);
    expect(r!.treatment.contaminated + r!.control.contaminated).toBe(1);
    expect(r!.treatment.assigned + r!.control.assigned).toBe(10);
    expect(r!.status).toBe("compromised");
  });
});
