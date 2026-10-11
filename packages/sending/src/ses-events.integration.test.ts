import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  contacts,
  createContact,
  createDb,
  emailEvents,
  suppressions,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_UTM } from "@mailory/core";
import { UNKNOWN_GRACE_MS, processSesEvent } from "./ses-events";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("SES events (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function fixture(status = "sending") {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const contact = (await createContact(db, oid, {
      email: `ev-${randomUUID().slice(0, 6)}@example.org`,
    }))!;
    const [camp] = await db
      .insert(campaigns)
      .values({ organizationId: org.id, name: "e", status, utm: DEFAULT_UTM })
      .returning();
    const messageId = `ses-${randomUUID()}`;
    const [rec] = await db
      .insert(campaignRecipients)
      .values({
        organizationId: org.id,
        campaignId: camp!.id,
        contactId: contact.id,
        email: contact.email,
        status: "sent",
        sentAt: new Date(),
        providerMessageId: messageId,
      })
      .returning();
    return { org, oid, contact, camp: camp!, rec: rec!, messageId };
  }
  const ev = (type: string, messageId: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ eventType: type, mail: { messageId }, ...extra });
  const recipient = async (id: string) =>
    (
      await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, id))
    )[0]!;
  const contactOf = async (id: string) =>
    (await db.select().from(contacts).where(eq(contacts.id, id)))[0]!;
  const now = new Date();

  it("delivery marks the recipient delivered", async () => {
    const f = await fixture();
    expect(
      await processSesEvent(
        { db },
        `e-${randomUUID()}`,
        ev("Delivery", f.messageId, { delivery: { timestamp: now.toISOString() } }),
        now,
      ),
    ).toBe("processed");
    expect(await recipient(f.rec.id)).toMatchObject({ status: "delivered" });
  });

  it("a permanent bounce ends the address everywhere in the workspace; a transient one does not", async () => {
    const f = await fixture();
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Bounce", f.messageId, {
        bounce: { bounceType: "Transient", bounceSubType: "MailboxFull" },
      }),
      now,
    );
    expect(await recipient(f.rec.id)).toMatchObject({ status: "sent" });
    expect((await contactOf(f.contact.id)).status).toBe("subscribed");

    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Bounce", f.messageId, { bounce: { bounceType: "Permanent" } }),
      now,
    );
    expect(await recipient(f.rec.id)).toMatchObject({ status: "bounced" });
    expect((await contactOf(f.contact.id)).status).toBe("bounced");
    const sup = await db
      .select()
      .from(suppressions)
      .where(
        and(
          eq(suppressions.organizationId, f.org.id),
          eq(suppressions.email, f.contact.email),
        ),
      );
    expect(sup.map((s) => s.reason)).toEqual(["hard_bounce"]);
  });

  it("a complaint suppresses and outranks an earlier delivery; a late delivery cannot undo it", async () => {
    const f = await fixture();
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Delivery", f.messageId),
      now,
    );
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Complaint", f.messageId, { complaint: {} }),
      now,
    );
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Delivery", f.messageId),
      now,
    );
    expect(await recipient(f.rec.id)).toMatchObject({ status: "complained" });
    expect((await contactOf(f.contact.id)).status).toBe("complained");
  });

  it("redelivery of the same SNS message is recorded once and harmless", async () => {
    const f = await fixture();
    const id = `e-${randomUUID()}`;
    const msg = ev("Bounce", f.messageId, { bounce: { bounceType: "Permanent" } });
    expect(await processSesEvent({ db }, id, msg, now)).toBe("processed");
    expect(await processSesEvent({ db }, id, msg, now)).toBe("duplicate");
    expect(
      await db.select().from(emailEvents).where(eq(emailEvents.providerEventId, id)),
    ).toHaveLength(1);
  });

  it("an unknown message id asks SNS to retry while fresh, then is dropped", async () => {
    const ghost = ev("Delivery", `ses-ghost-${randomUUID()}`, {
      delivery: { timestamp: now.toISOString() },
    });
    expect(
      await processSesEvent({ db, now: () => now }, `e-${randomUUID()}`, ghost, now),
    ).toBe("retry_later");
    const later = new Date(now.getTime() + UNKNOWN_GRACE_MS + 1000);
    expect(
      await processSesEvent({ db, now: () => later }, `e-${randomUUID()}`, ghost, now),
    ).toBe("unknown_message");
  });

  it("ignores malformed payloads and accepts the legacy notificationType field", async () => {
    const f = await fixture();
    expect(await processSesEvent({ db }, `e-${randomUUID()}`, "not json", now)).toBe(
      "ignored",
    );
    expect(await processSesEvent({ db }, `e-${randomUUID()}`, "{}", now)).toBe(
      "ignored",
    );
    const legacy = JSON.stringify({
      notificationType: "Delivery",
      mail: { messageId: f.messageId },
    });
    expect(await processSesEvent({ db }, `e-${randomUUID()}`, legacy, now)).toBe(
      "processed",
    );
    expect(await recipient(f.rec.id)).toMatchObject({ status: "delivered" });
  });

  it("auto-pauses the campaign when a complaint pushes the rate over the limit", async () => {
    const f = await fixture();
    await db.insert(campaignRecipients).values(
      Array.from({ length: 250 }, (_, i) => ({
        organizationId: f.org.id,
        campaignId: f.camp.id,
        email: `bulk${i}-${randomUUID().slice(0, 4)}@example.org`,
        status: "delivered",
        sentAt: new Date(),
      })),
    );
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Complaint", f.messageId, { complaint: {} }),
      now,
    );
    expect(
      (await db.select().from(campaigns).where(eq(campaigns.id, f.camp.id)))[0],
    ).toMatchObject({ status: "sending" }); // 1/252 < 0.5%
    const f2 = await fixture();
    await db.insert(campaignRecipients).values(
      Array.from({ length: 100 }, (_, i) => ({
        organizationId: f2.org.id,
        campaignId: f2.camp.id,
        email: `b${i}-${randomUUID().slice(0, 4)}@example.org`,
        status: "delivered",
        sentAt: new Date(),
      })),
    );
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Complaint", f2.messageId, { complaint: {} }),
      now,
    );
    const row = (
      await db.select().from(campaigns).where(eq(campaigns.id, f2.camp.id))
    )[0]!;
    expect(row).toMatchObject({ status: "paused", haltReason: "complaint_rate" });
  });

  it("does not touch another tenant even if message ids collide in intent", async () => {
    const a = await fixture();
    const b = await fixture();
    await processSesEvent(
      { db },
      `e-${randomUUID()}`,
      ev("Bounce", a.messageId, { bounce: { bounceType: "Permanent" } }),
      now,
    );
    expect(await recipient(b.rec.id)).toMatchObject({ status: "sent" });
    expect((await contactOf(b.contact.id)).status).toBe("subscribed");
  });
});
