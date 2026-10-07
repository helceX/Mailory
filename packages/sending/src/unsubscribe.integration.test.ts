import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  asOrganizationId,
  auditLogs,
  campaignRecipients,
  campaigns,
  contacts,
  createContact,
  createDb,
  suppressions,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_UTM, unsubscribeToken } from "@mailory/core";
import { lookupUnsubscribe, maskEmail, unsubscribeByToken } from "./unsubscribe";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SECRET = "u".repeat(48);

suite("unsubscribe (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function fixture() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id, `Acme ${randomUUID().slice(0, 4)}`);
    const oid = asOrganizationId(org.id);
    const contact = (await createContact(db, oid, {
      email: `kisi-${randomUUID().slice(0, 6)}@example.org`,
    }))!;
    const [camp] = await db
      .insert(campaigns)
      .values({ organizationId: org.id, name: "c", utm: DEFAULT_UTM })
      .returning();
    const [rec] = await db
      .insert(campaignRecipients)
      .values({
        organizationId: org.id,
        campaignId: camp!.id,
        contactId: contact.id,
        email: contact.email,
        status: "sent",
      })
      .returning();
    return {
      org,
      oid,
      contact,
      rec: rec!,
      token: unsubscribeToken(SECRET, org.id, rec!.id),
    };
  }

  it("looking up shows a masked address and changes nothing (GET must be safe)", async () => {
    const f = await fixture();
    const r = await lookupUnsubscribe({ db, secret: SECRET }, f.token);
    expect(r).toMatchObject({ ok: true, orgName: f.org.name });
    if (r.ok) expect(r.maskedEmail).toBe(maskEmail(f.contact.email));
    expect(r.ok && r.maskedEmail).not.toContain(f.contact.email.split("@")[0]);
    const c = (
      await db.select().from(contacts).where(eq(contacts.id, f.contact.id))
    )[0]!;
    expect(c.status).toBe("subscribed");
  });

  it("unsubscribes: suppresses, flips the contact, marks the recipient and audits — idempotently", async () => {
    const f = await fixture();
    expect(
      await unsubscribeByToken({ db, secret: SECRET }, f.token, "one_click"),
    ).toEqual({ ok: true });
    expect(await unsubscribeByToken({ db, secret: SECRET }, f.token, "link")).toEqual({
      ok: true,
    });
    const c = (
      await db.select().from(contacts).where(eq(contacts.id, f.contact.id))
    )[0]!;
    expect(c).toMatchObject({ status: "unsubscribed", consentStatus: "withdrawn" });
    const sup = await db
      .select()
      .from(suppressions)
      .where(
        and(
          eq(suppressions.organizationId, f.org.id),
          eq(suppressions.email, f.contact.email),
        ),
      );
    expect(sup).toHaveLength(1);
    expect(sup[0]!.reason).toBe("unsubscribe");
    const rec = (
      await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.id, f.rec.id))
    )[0]!;
    expect(rec.unsubscribedAt).not.toBeNull();
    const audits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, f.org.id),
          eq(auditLogs.action, "contact.unsubscribed"),
        ),
      );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects forged, foreign-secret and cross-tenant tokens without touching anything", async () => {
    const a = await fixture();
    const b = await fixture();
    expect(
      (await unsubscribeByToken({ db, secret: SECRET }, "garbage", "link")).ok,
    ).toBe(false);
    expect(
      (await unsubscribeByToken({ db, secret: "x".repeat(48) }, a.token, "link")).ok,
    ).toBe(false);
    // Org A's id with org B's recipient id: not found, and B's contact stays subscribed.
    const mixed = unsubscribeToken(SECRET, a.org.id, b.rec.id);
    expect((await unsubscribeByToken({ db, secret: SECRET }, mixed, "link")).ok).toBe(
      false,
    );
    const cb = (
      await db.select().from(contacts).where(eq(contacts.id, b.contact.id))
    )[0]!;
    expect(cb.status).toBe("subscribed");
  });

  it("only affects the organization that sent the mail", async () => {
    const a = await fixture();
    const other = await createTestOrg(db, (await createTestUser(db)).id);
    await createContact(db, asOrganizationId(other.id), { email: a.contact.email });
    await unsubscribeByToken({ db, secret: SECRET }, a.token, "link");
    const theirs = (
      await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, other.id),
            eq(contacts.email, a.contact.email),
          ),
        )
    )[0]!;
    expect(theirs.status).toBe("subscribed");
  });
});
