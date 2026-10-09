import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_UTM } from "@mailory/core";
import {
  asOrganizationId,
  campaignLinks,
  campaignRecipients,
  campaigns,
  contacts,
  createDb,
  getOrganization,
  organizations,
  senderIdentities,
  suppressions,
  templateVersions,
  templates,
  trackingEvents,
  eraseContact,
  exportContactData,
  purgeDeletedOrganizations,
  restoreOrganization,
  runRetention,
  softDeleteOrganization,
  RETENTION,
  type Database,
} from "../index";
import { createTestOrg, createTestUser } from "../testing";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const DAY = 86_400_000;

suite("privacy: export, erasure, workspace deletion, retention (real Postgres)", () => {
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
    const [contact] = await db
      .insert(contacts)
      .values({
        organizationId: o,
        email: `p-${randomUUID().slice(0, 6)}@example.org`,
        firstName: "Ayşe",
      })
      .returning();
    const [identity] = await db
      .insert(senderIdentities)
      .values({
        organizationId: o,
        fromName: "A",
        fromEmail: `i-${randomUUID().slice(0, 6)}@example.org`,
      })
      .returning();
    const [template] = await db
      .insert(templates)
      .values({ organizationId: o, name: "T", category: "other" })
      .returning();
    const [version] = await db
      .insert(templateVersions)
      .values({
        templateId: template!.id,
        organizationId: o,
        version: Math.floor(Math.random() * 1_000_000) + 1,
        doc: {},
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        organizationId: o,
        name: "Kampanya",
        subject: "Merhaba",
        utm: DEFAULT_UTM,
        senderIdentityId: identity!.id,
        templateId: template!.id,
        templateVersionId: version!.id,
        status: "sending",
      })
      .returning();
    const [recipient] = await db
      .insert(campaignRecipients)
      .values({
        organizationId: o,
        campaignId: campaign!.id,
        contactId: contact!.id,
        email: contact!.email,
      })
      .returning();
    const [link] = await db
      .insert(campaignLinks)
      .values({
        organizationId: o,
        campaignId: campaign!.id,
        url: `https://x.com/${randomUUID()}`,
      })
      .returning();
    await db.insert(trackingEvents).values({
      organizationId: o,
      campaignId: campaign!.id,
      recipientId: recipient!.id,
      linkId: link!.id,
      type: "click",
    });
    return {
      o: asOrganizationId(o),
      contact: contact!,
      campaign: campaign!,
      recipient: recipient!,
    };
  }

  it("exports what we hold about a contact, scoped to the workspace", async () => {
    const w = await world();
    const other = await world();
    const data = await exportContactData(db, w.o, w.contact.id);
    expect(data?.contact.email).toBe(w.contact.email);
    expect(data?.contact.firstName).toBe("Ayşe");
    expect(data?.emailsReceived).toHaveLength(1);
    expect(data?.emailsReceived[0]).toMatchObject({
      campaign: "Kampanya",
      subject: "Merhaba",
    });
    expect(data?.interactions).toHaveLength(1);
    // Another tenant's contact id is simply not found.
    expect(await exportContactData(db, w.o, other.contact.id)).toBeNull();
  });

  it("erases a contact: anonymizes recipients, drops tracking events, keeps opt-out suppressions", async () => {
    const w = await world();
    await db
      .insert(suppressions)
      .values({ organizationId: w.o, email: w.contact.email, reason: "unsubscribe" });
    const result = await eraseContact(db, w.o, w.contact.id);
    expect(result).toMatchObject({ recipientsAnonymized: 1, eventsDeleted: 1 });
    expect(
      await db.select().from(contacts).where(eq(contacts.id, w.contact.id)),
    ).toHaveLength(0);
    const [r] = await db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.id, w.recipient.id));
    expect(r!.email).toMatch(/@erased\.invalid$/);
    expect(r!.email).not.toContain(w.contact.email);
    const ev = await db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.recipientId, w.recipient.id));
    expect(ev).toHaveLength(0);
    // The opt-out stays so the address can never be mailed again.
    const kept = await db
      .select()
      .from(suppressions)
      .where(eq(suppressions.email, w.contact.email));
    expect(kept.filter((s) => s.organizationId === w.o)).toHaveLength(1);
  });

  it("erasure is tenant-scoped and idempotent", async () => {
    const w = await world();
    const other = await world();
    expect(await eraseContact(db, w.o, other.contact.id)).toBeNull();
    expect(
      await db.select().from(contacts).where(eq(contacts.id, other.contact.id)),
    ).toHaveLength(1);
    expect(await eraseContact(db, w.o, w.contact.id)).not.toBeNull();
    expect(await eraseContact(db, w.o, w.contact.id)).toBeNull();
  });

  it("workspace deletion hides the org, halts sending, is restorable in grace and purged after", async () => {
    const w = await world();
    const t0 = new Date();
    expect(await softDeleteOrganization(db, w.o, t0)).toBe(true);
    expect(await softDeleteOrganization(db, w.o, t0)).toBe(false);
    expect(await getOrganization(db, w.o)).toBeNull();
    const [c] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, w.campaign.id));
    expect(c).toMatchObject({ status: "paused", haltReason: "org_deleted" });

    // Restore inside the grace period.
    expect(await restoreOrganization(db, w.o, new Date(t0.getTime() + 5 * DAY))).toBe(
      true,
    );
    expect(await getOrganization(db, w.o)).not.toBeNull();

    // Delete again; purge only once the grace period has passed.
    await softDeleteOrganization(db, w.o, t0);
    expect(
      await purgeDeletedOrganizations(db, new Date(t0.getTime() + 29 * DAY)),
    ).not.toContain(w.o);
    expect(await restoreOrganization(db, w.o, new Date(t0.getTime() + 31 * DAY))).toBe(
      false,
    );
    expect(
      await purgeDeletedOrganizations(db, new Date(t0.getTime() + 31 * DAY)),
    ).toContain(w.o);
    expect(
      await db.select().from(organizations).where(eq(organizations.id, w.o)),
    ).toHaveLength(0);
    expect(
      await db.select().from(contacts).where(eq(contacts.id, w.contact.id)),
    ).toHaveLength(0);
  });

  it("retention removes old events (bots sooner) and keeps recent ones", async () => {
    const w = await world();
    const now = new Date();
    const link = await db
      .select()
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, w.campaign.id));
    const mk = (ageDays: number, isBot: boolean) =>
      db.insert(trackingEvents).values({
        organizationId: w.o,
        campaignId: w.campaign.id,
        recipientId: w.recipient.id,
        linkId: link[0]!.id,
        type: "click",
        isBot,
        occurredAt: new Date(now.getTime() - ageDays * DAY),
      });
    await mk(RETENTION.trackingDays + 5, false); // too old
    await mk(RETENTION.botTrackingDays + 5, true); // old bot
    await mk(RETENTION.botTrackingDays + 5, false); // human at the same age: kept
    await mk(2, true); // fresh bot: kept
    const before = (
      await db
        .select()
        .from(trackingEvents)
        .where(eq(trackingEvents.recipientId, w.recipient.id))
    ).length;
    await runRetention(db, now);
    const after = await db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.recipientId, w.recipient.id));
    expect(before - after.length).toBe(2);
    expect(
      after.some(
        (e) =>
          e.isBot &&
          now.getTime() - e.occurredAt.getTime() > RETENTION.botTrackingDays * DAY,
      ),
    ).toBe(false);
    void sql;
  });
});
