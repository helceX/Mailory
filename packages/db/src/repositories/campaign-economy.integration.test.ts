import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  DEFAULT_UTM,
  economicalAudienceHealth,
  planAudience,
  type CampaignAudience,
} from "@mailory/core";
import {
  addContactsToList,
  addSuppressions,
  asOrganizationId,
  audienceEngagement,
  campaignRecipients,
  contacts,
  contactTags,
  countSendable,
  createCampaign,
  createContact,
  createDb,
  createList,
  createSegment,
  createTag,
  materializeRecipients,
  resolveAudienceFilter,
  type Database,
} from "../index";
import { createTwoTenants } from "../testing";

const url = process.env.DATABASE_URL;
(url ? describe : describe.skip)("campaign economy (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function fixture() {
    const tenants = await createTwoTenants(db);
    const org = asOrganizationId(tenants.orgA.id);
    const rows = [];
    for (const [label, score, status] of [
      ["active", 80, "subscribed"],
      ["cold", 10, "subscribed"],
      ["dormant", 0, "subscribed"],
      ["new", null, "subscribed"],
      ["blocked", 80, "subscribed"],
      ["unsubscribed", 80, "unsubscribed"],
    ] as const) {
      const row = (await createContact(db, org, {
        email: `${label}-${randomUUID()}@example.com`,
        status,
        company: "Selected",
      }))!;
      await db
        .update(contacts)
        .set({ engagementScore: score })
        .where(and(eq(contacts.organizationId, org), eq(contacts.id, row.id)));
      rows.push({ ...row, label });
    }
    await addSuppressions(db, org, {
      emails: [rows[4]!.email],
      reason: "unsubscribe",
      userId: null,
    });
    await createContact(db, asOrganizationId(tenants.orgB.id), {
      email: `other-${randomUUID()}@example.com`,
      company: "Selected",
    });
    return { ...tenants, org, rows };
  }

  it("default mode retains dormant people; opt-in preview exactly matches frozen recipients without mutating contacts", async () => {
    const { org, rows } = await fixture();
    const standard = (await resolveAudienceFilter(db, org, { kind: "all" })).filter!;
    const filtered = (
      await resolveAudienceFilter(db, org, { kind: "all", excludeDormant: true })
    ).filter!;
    expect(await countSendable(db, org, standard)).toBe(4);
    expect(await countSendable(db, org, filtered)).toBe(3);
    const base = await audienceEngagement(db, org, standard);
    expect(planAudience(base)).toMatchObject({
      standard: 4,
      economical: 3,
      avoided: 1,
      unscored: 1,
    });
    expect(economicalAudienceHealth(base)).toEqual(
      await audienceEngagement(db, org, filtered),
    );
    const campaign = await createCampaign(db, org, {
      name: "Economy",
      audience: { kind: "all", excludeDormant: true },
      utm: DEFAULT_UTM,
      createdByUserId: null,
    });
    expect(
      await materializeRecipients(db, org, campaign.id, filtered, new Date()),
    ).toBe(3);
    expect(
      await materializeRecipients(db, org, campaign.id, filtered, new Date()),
    ).toBe(0);
    const recipients = await db
      .select()
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.organizationId, org),
          eq(campaignRecipients.campaignId, campaign.id),
        ),
      );
    expect(recipients.map((r) => r.contactId).sort()).toEqual(
      rows
        .slice(0, 4)
        .filter((r) => r.label !== "dormant")
        .map((r) => r.id)
        .sort(),
    );
    const unchanged = await db
      .select()
      .from(contacts)
      .where(eq(contacts.organizationId, org));
    expect(unchanged).toHaveLength(6);
    expect(unchanged.find((c) => c.id === rows[2]!.id)?.status).toBe("subscribed");
  });

  it("composes economy mode with lists, tags and segments, and refuses foreign tenant sources", async () => {
    const { org, rows, orgB } = await fixture();
    const list = (await createList(db, org, { name: "Selected list" }))!;
    await addContactsToList(db, org, list.id, {
      ids: [rows[0]!.id, rows[2]!.id, rows[3]!.id],
    });
    const tag = (await createTag(db, org, "Selected tag"))!;
    await db
      .insert(contactTags)
      .values(
        rows
          .slice(0, 4)
          .map((r) => ({ organizationId: org, contactId: r.id, tagId: tag.id })),
      );
    const segment = (await createSegment(db, org, {
      name: "Selected segment",
      definition: { type: "rule", field: "company", op: "eq", value: "Selected" },
      userId: null,
    }))!;
    for (const [kind, id, expected] of [
      ["list", list.id, 2],
      ["tag", tag.id, 3],
      ["segment", segment.id, 3],
    ] as const) {
      const audience: CampaignAudience = { kind, id, excludeDormant: true };
      const resolved = await resolveAudienceFilter(db, org, audience);
      expect(resolved.exists).toBe(true);
      expect(await countSendable(db, org, resolved.filter!)).toBe(expected);
      const foreign = await resolveAudienceFilter(
        db,
        asOrganizationId(orgB.id),
        audience,
      );
      expect(foreign.exists).toBe(false);
      if (foreign.filter)
        expect(await countSendable(db, asOrganizationId(orgB.id), foreign.filter)).toBe(
          0,
        );
    }
  });
});
