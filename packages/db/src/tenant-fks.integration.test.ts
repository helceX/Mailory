import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DEFAULT_UTM } from "@mailory/core";
import {
  asOrganizationId, assets, automationEnrollments, automations, brandKits, campaignLinks, campaignRecipients, campaigns,
  contactTags, contacts, createDb, listContactLinks, lists, senderIdentities, tags, templateVersions, templates,
  trackingEvents, type Database,
} from "./index";
import { createTestOrg, createTestUser } from "./testing";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("composite tenant foreign keys (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  /** One organization with one row of every referenced kind, all wired together legitimately. */
  async function world() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const o = org.id;
    const [list] = await db.insert(lists).values({ organizationId: o, name: "L" }).returning();
    const [tag] = await db.insert(tags).values({ organizationId: o, name: "T" }).returning();
    const [contact] = await db.insert(contacts).values({ organizationId: o, email: `c-${randomUUID().slice(0, 6)}@example.org` }).returning();
    const [identity] = await db.insert(senderIdentities).values({ organizationId: o, fromName: "A", fromEmail: `i-${randomUUID().slice(0, 6)}@example.org` }).returning();
    const [template] = await db.insert(templates).values({ organizationId: o, name: "T", category: "other" }).returning();
    const [version] = await db.insert(templateVersions).values({ templateId: template!.id, organizationId: o, version: Math.floor(Math.random() * 1_000_000) + 1, doc: {} }).returning();
    const [automation] = await db.insert(automations).values({ organizationId: o, name: "A", trigger: { type: "manual" } }).returning();
    const [campaign] = await db.insert(campaigns).values({ organizationId: o, name: "C", utm: DEFAULT_UTM, senderIdentityId: identity!.id, templateId: template!.id, templateVersionId: version!.id }).returning();
    const [recipient] = await db.insert(campaignRecipients).values({ organizationId: o, campaignId: campaign!.id, contactId: contact!.id, email: contact!.email }).returning();
    const [link] = await db.insert(campaignLinks).values({ organizationId: o, campaignId: campaign!.id, url: `https://x.com/${randomUUID()}` }).returning();
    const [asset] = await db.insert(assets).values({ organizationId: o, contentType: "image/png", size: 1, sha256: "x", data: Buffer.from("x") }).returning();
    await db.insert(listContactLinks).values({ listId: list!.id, contactId: contact!.id, organizationId: o });
    await db.insert(contactTags).values({ tagId: tag!.id, contactId: contact!.id, organizationId: o });
    await db.insert(trackingEvents).values({ organizationId: o, campaignId: campaign!.id, recipientId: recipient!.id, linkId: link!.id, type: "click" });
    await db.insert(automationEnrollments).values({ organizationId: o, automationId: automation!.id, contactId: contact!.id, lastRecipientId: recipient!.id });
    await db.insert(brandKits).values({ organizationId: o, primaryColor: "#000", textColor: "#000", backgroundColor: "#fff", linkColor: "#000", buttonColor: "#000", buttonTextColor: "#fff", font: "sans", buttonRadius: 4, logoAssetId: asset!.id });
    return { o, list: list!, tag: tag!, contact: contact!, identity: identity!, template: template!, version: version!, automation: automation!, campaign: campaign!, recipient: recipient!, link: link!, asset: asset! };
  }

  const violation = async (statement: ReturnType<typeof sql>) => {
    try {
      await db.execute(statement);
      return null;
    } catch (e) {
      const err = e as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
      return { code: err.cause?.code ?? err.code, constraint: err.cause?.constraint ?? err.constraint };
    }
  };

  // [table, column, key of the foreign parent in the other world, where-clause column on the child]
  const cases: [string, string, keyof Awaited<ReturnType<typeof world>>, string][] = [
    ["list_contacts", "list_id", "list", "contact_id"],
    ["list_contacts", "contact_id", "contact", "list_id"],
    ["contact_tags", "tag_id", "tag", "contact_id"],
    ["contact_tags", "contact_id", "contact", "tag_id"],
    ["campaigns", "sender_identity_id", "identity", "id"],
    ["campaigns", "template_id", "template", "id"],
    ["campaigns", "template_version_id", "version", "id"],
    ["campaign_recipients", "campaign_id", "campaign", "id"],
    ["campaign_recipients", "contact_id", "contact", "id"],
    ["campaign_links", "campaign_id", "campaign", "id"],
    ["tracking_events", "campaign_id", "campaign", "recipient_id"],
    ["tracking_events", "recipient_id", "recipient", "campaign_id"],
    ["tracking_events", "link_id", "link", "campaign_id"],
    ["automation_enrollments", "automation_id", "automation", "contact_id"],
    ["automation_enrollments", "contact_id", "contact", "automation_id"],
    ["automation_enrollments", "last_recipient_id", "recipient", "contact_id"],
    ["template_versions", "template_id", "template", "id"],
    ["brand_kits", "logo_asset_id", "asset", "organization_id"],
  ];

  it.each(cases)("%s.%s cannot point at another organization's row", async (table, column, parentKey, whereCol) => {
    const a = await world();
    const b = await world();
    const mineKey = {
      list_contacts: a.contact.id, contact_tags: a.contact.id, campaigns: a.campaign.id, campaign_recipients: a.recipient.id,
      campaign_links: a.link.id, tracking_events: a.campaign.id, automation_enrollments: a.contact.id, template_versions: a.version.id,
      brand_kits: a.o,
    } as Record<string, string>;
    void mineKey;
    const foreign = (b[parentKey] as { id: string }).id;
    // Pick the exact row of world A by its organization (each world has exactly one row per table).
    const stmt = sql`update ${sql.raw(`"${table}"`)} set ${sql.raw(`"${column}"`)} = ${foreign}::uuid where ${sql.raw(`"organization_id"`)} = ${a.o}::uuid`;
    void whereCol;
    const v = await violation(stmt);
    expect(v, `${table}.${column} accepted a cross-tenant reference`).not.toBeNull();
    expect(v!.code).toBe("23503");
    expect(v!.constraint).toBe(`${table}_${column}_org_fk`);
  });

  it("same-organization references still work, and deleting a parent keeps cascading as before", async () => {
    const a = await world();
    await expect(db.execute(sql`update campaigns set template_id = ${a.template.id}::uuid where id = ${a.campaign.id}::uuid`)).resolves.toBeDefined();
    await db.execute(sql`delete from campaigns where id = ${a.campaign.id}::uuid`);
    const left = await db.execute<{ n: number }>(sql`select count(*)::int as n from campaign_recipients where organization_id = ${a.o}::uuid`);
    expect(left.rows[0]!.n).toBe(0); // cascade unchanged
    await db.execute(sql`delete from templates where id = ${a.template.id}::uuid`); // set-null / cascade paths still allowed
    void asOrganizationId;
  });
});
