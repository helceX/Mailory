import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  claimRecipients,
  contacts,
  createContact,
  createDb,
  createSenderDomain,
  organizations,
  senderDomains,
  setOverride,
  suppressions,
  type Campaign,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_BRAND, DEFAULT_UTM, readUnsubscribeToken } from "@mailory/core";
import {
  ConsoleTransport,
  blankTemplate,
  type EmailTransport,
  type OutgoingEmail,
  type SendOutcome,
} from "@mailory/email";
import {
  HEALTH,
  MAX_ATTEMPTS,
  dispatchDue,
  evaluateHealth,
  resumeDailyLimited,
  sendBatch,
  tick,
  type EngineDeps,
} from "./engine";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SECRET = "s".repeat(48);
const APP = "https://app.test";

class ScriptedTransport implements EmailTransport {
  readonly name = "scripted";
  sent: OutgoingEmail[] = [];
  attempts = new Map<string, number>();
  constructor(
    private readonly script: (
      m: OutgoingEmail,
      attempt: number,
    ) => SendOutcome | null = () => null,
  ) {}
  async send(m: OutgoingEmail): Promise<SendOutcome> {
    const n = (this.attempts.get(m.to) ?? 0) + 1;
    this.attempts.set(m.to, n);
    const scripted = this.script(m, n);
    if (scripted) return scripted;
    this.sent.push(m);
    return { ok: true, messageId: `msg-${randomUUID()}` };
  }
}

suite("send engine (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let clock: Date;

  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  let scopeOrg: string | undefined;
  const deps = (
    transport: EmailTransport,
    extra: Partial<EngineDeps> = {},
  ): EngineDeps => ({
    scope: { organizationId: scopeOrg },
    db,
    transport,
    appUrl: APP,
    secret: SECRET,
    now: () => clock,
    sleep: async () => {},
    ratePerSecond: 1000,
    ...extra,
  });

  /** A scheduled campaign with a frozen snapshot, `n` subscribed contacts, ready for the dispatcher. */
  async function setup(n = 3, opts: { verified?: boolean; subject?: string } = {}) {
    clock = new Date("2026-03-01T10:00:00Z");
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const domain = `eng-${randomUUID().slice(0, 8)}.com`;
    const d = (await createSenderDomain(db, oid, {
      domain,
      provider: "mock",
      dkimTokens: ["a", "b", "c"],
      ownershipToken: "t".repeat(32),
      userId: user.id,
    }))!;
    if (opts.verified !== false)
      await db
        .update(senderDomains)
        .set({ status: "verified" })
        .where(eq(senderDomains.id, d.id));
    const emails: string[] = [];
    for (let i = 0; i < n; i++) {
      const email = `r${i}-${randomUUID().slice(0, 6)}@example.org`;
      emails.push(email);
      await createContact(db, oid, { email, firstName: `Ad${i}` });
    }
    const doc = blankTemplate(DEFAULT_BRAND);
    const [campaign] = await db
      .insert(campaigns)
      .values({
        organizationId: org.id,
        name: "Motor",
        status: "scheduled",
        subject: opts.subject ?? "Merhaba {{first_name|dost}}",
        audience: { kind: "all" },
        utm: { ...DEFAULT_UTM, campaign: "motor" },
        scheduledAt: new Date("2026-03-01T09:00:00Z"),
        snapshot: {
          doc,
          version: 1,
          brand: DEFAULT_BRAND,
          sender: { fromName: "Acme", fromEmail: `info@${domain}`, replyTo: null },
          audienceCount: n,
          takenAt: clock.toISOString(),
        },
      })
      .returning();
    scopeOrg = org.id;
    return { user, org, oid, domain, emails, campaign: campaign! };
  }
  const row = async (id: string) =>
    (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0]!;
  const recipients = (campaignId: string) =>
    db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, campaignId));
  async function drain(d: EngineDeps, c: Campaign, rounds = 20) {
    for (let i = 0; i < rounds; i++) {
      const fresh = await row(c.id);
      if (fresh.status !== "sending") return;
      const r = await sendBatch(d, fresh);
      if (r.claimed === 0 || r.halted) return;
    }
  }

  it("sends to every eligible contact exactly once and completes", async () => {
    const s = await setup(3);
    await db.insert(contacts).values({
      organizationId: s.org.id,
      email: `unsub-${randomUUID().slice(0, 5)}@example.org`,
      status: "unsubscribed",
    });
    const sup = `sup-${randomUUID().slice(0, 5)}@example.org`;
    await createContact(db, s.oid, { email: sup });
    await db
      .insert(suppressions)
      .values({ organizationId: s.org.id, email: sup, reason: "manual" });

    const t = new ScriptedTransport();
    const d = deps(t);
    expect((await dispatchDue(d)).started).toBeGreaterThanOrEqual(1);
    const recs = await recipients(s.campaign.id);
    expect(recs.map((r) => r.email).sort()).toEqual([...s.emails].sort());
    await drain(d, s.campaign);

    expect(t.sent.map((m) => m.to).sort()).toEqual([...s.emails].sort());
    expect(await row(s.campaign.id)).toMatchObject({ status: "completed" });
    expect(
      (await recipients(s.campaign.id)).every(
        (r) => r.status === "sent" && r.providerMessageId,
      ),
    ).toBe(true);
    const m = t.sent[0]!;
    expect(m.subject).toMatch(/^Merhaba Ad\d$/);
    expect(m.from).toEqual({ name: "Acme", email: `info@${s.domain}` });
    const rec = recs.find((r) => r.email === m.to)!;
    const token = /<https:\/\/app\.test\/api\/unsubscribe\/([^>]+)>/.exec(
      m.headers!["List-Unsubscribe"]!,
    )![1]!;
    expect(readUnsubscribeToken(SECRET, token)).toEqual({
      organizationId: s.org.id,
      recipientId: rec.id,
    });
    expect(m.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.html).toContain(`https://app.test/unsubscribe/${token}`);
    expect(m.tags).toMatchObject({ campaign_id: s.campaign.id, recipient_id: rec.id });
  });

  it("dispatching twice never duplicates recipients or sends", async () => {
    const s = await setup(4);
    const t = new ScriptedTransport();
    const d = deps(t);
    await dispatchDue(d);
    await dispatchDue(d);
    await drain(d, s.campaign);
    await tick(d);
    expect(await recipients(s.campaign.id)).toHaveLength(4);
    expect(t.sent).toHaveLength(4);
  });

  it("concurrent workers never send the same recipient twice", async () => {
    const s = await setup(30);
    const t = new ScriptedTransport();
    const d = deps(t, { batchSize: 7 });
    await dispatchDue(d);
    const c = await row(s.campaign.id);
    await Promise.all(
      [0, 1, 2, 3].map(async () => {
        for (let i = 0; i < 10; i++) if ((await sendBatch(d, c)).claimed === 0) break;
      }),
    );
    expect(t.sent).toHaveLength(30);
    expect(new Set(t.sent.map((m) => m.to)).size).toBe(30);
    expect(Math.max(...t.attempts.values())).toBe(1);
    expect((await recipients(s.campaign.id)).every((r) => r.status === "sent")).toBe(
      true,
    );
  });

  it("claiming skips rows another worker holds locked instead of waiting or taking them", async () => {
    const s = await setup(3);
    const d = deps(new ScriptedTransport());
    await dispatchDue(d);
    const [held] = await recipients(s.campaign.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from campaign_recipients where id = ${held!.id}::uuid for update`,
      );
      locked();
      await gate;
    });
    await lockedP;
    const got = await Promise.race([
      claimRecipients(db, s.oid, s.campaign.id, 10, clock),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    release();
    await holder;
    expect(got).not.toBeNull();
    expect(got!.map((r) => r.id)).not.toContain(held!.id);
    expect(got).toHaveLength(2);
  });

  it("retries transient failures with backoff, then succeeds", async () => {
    const s = await setup(1);
    const t = new ScriptedTransport((_m, attempt) =>
      attempt === 1
        ? { ok: false, retryable: true, code: "ThrottlingException", message: "slow" }
        : null,
    );
    const d = deps(t);
    await dispatchDue(d);
    await sendBatch(d, await row(s.campaign.id));
    let r = (await recipients(s.campaign.id))[0]!;
    expect(r).toMatchObject({ status: "queued", attempts: 1 });
    expect(r.lastError).toContain("ThrottlingException");
    expect(r.nextAttemptAt.getTime()).toBeGreaterThan(clock.getTime());
    // Not due yet: nothing is claimed.
    expect((await sendBatch(d, await row(s.campaign.id))).claimed).toBe(0);
    clock = new Date(clock.getTime() + 60_000);
    await drain(d, s.campaign);
    r = (await recipients(s.campaign.id))[0]!;
    expect(r).toMatchObject({ status: "sent", attempts: 2 });
    expect(await row(s.campaign.id)).toMatchObject({ status: "completed" });
  });

  it("gives up after the maximum attempts, and permanent errors fail immediately", async () => {
    const s = await setup(2);
    const [bad, flaky] = s.emails;
    const t = new ScriptedTransport((m) =>
      m.to === bad
        ? {
            ok: false,
            retryable: false,
            code: "MessageRejected",
            message: "bad address",
          }
        : { ok: false, retryable: true, code: "ServiceUnavailable", message: "503" },
    );
    const d = deps(t);
    await dispatchDue(d);
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      clock = new Date(clock.getTime() + 2 * 3600_000);
      await sendBatch(d, await row(s.campaign.id));
    }
    const recs = await recipients(s.campaign.id);
    expect(recs.find((r) => r.email === bad)).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    expect(recs.find((r) => r.email === flaky)).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
    });
    expect(await row(s.campaign.id)).toMatchObject({ status: "completed" });
  });

  it("skips a contact who unsubscribed after the list was frozen", async () => {
    const s = await setup(2);
    const t = new ScriptedTransport();
    const d = deps(t);
    await dispatchDue(d);
    await db
      .update(contacts)
      .set({ status: "unsubscribed" })
      .where(
        and(eq(contacts.organizationId, s.org.id), eq(contacts.email, s.emails[0]!)),
      );
    await drain(d, s.campaign);
    expect(t.sent.map((m) => m.to)).toEqual([s.emails[1]]);
    expect(
      (await recipients(s.campaign.id)).find((r) => r.email === s.emails[0]),
    ).toMatchObject({ status: "skipped", lastError: "no_longer_subscribed" });
  });

  it("enforces the daily cap, then resumes by itself the next UTC day", async () => {
    const s = await setup(5);
    await db
      .update(organizations)
      .set({ dailySendLimit: 2 })
      .where(eq(organizations.id, s.org.id));
    const t = new ScriptedTransport();
    const d = deps(t, { batchSize: 10 });
    await dispatchDue(d);
    await drain(d, s.campaign);
    await sendBatch(d, await row(s.campaign.id));
    expect(t.sent).toHaveLength(2);
    expect(await row(s.campaign.id)).toMatchObject({
      status: "paused",
      haltReason: "daily_limit",
    });
    // Same day: still capped.
    expect((await resumeDailyLimited(d)).resumed).toBe(0);
    clock = new Date("2026-03-02T00:30:00Z");
    expect((await resumeDailyLimited(d)).resumed).toBeGreaterThanOrEqual(1);
    await drain(d, s.campaign);
    expect(t.sent).toHaveLength(4);
    await db
      .update(organizations)
      .set({ dailySendLimit: 100 })
      .where(eq(organizations.id, s.org.id));
    await resumeDailyLimited(d);
    await drain(d, s.campaign);
    expect(t.sent).toHaveLength(5);
    expect(await row(s.campaign.id)).toMatchObject({
      status: "completed",
      haltReason: null,
    });
  });

  it("stops at the monthly plan limit, resumes when the limit is raised, and counts only this month", async () => {
    const s = await setup(5);
    await setOverride(db, s.oid, {
      key: "emails_per_month",
      limit: 2,
      reason: "t",
      userId: null,
      byOrganizationId: null,
    });
    const t = new ScriptedTransport();
    const d = deps(t, { batchSize: 10 });
    await dispatchDue(d);
    await drain(d, s.campaign);
    await sendBatch(d, await row(s.campaign.id));
    expect(t.sent).toHaveLength(2);
    expect(await row(s.campaign.id)).toMatchObject({
      status: "paused",
      haltReason: "plan_limit",
    });
    expect((await resumeDailyLimited(d)).resumed).toBe(0); // still capped
    await setOverride(db, s.oid, {
      key: "emails_per_month",
      limit: 10,
      reason: "t",
      userId: null,
      byOrganizationId: null,
    });
    expect((await resumeDailyLimited(d)).resumed).toBeGreaterThanOrEqual(1);
    await drain(d, s.campaign);
    expect(t.sent).toHaveLength(5);
    expect(await row(s.campaign.id)).toMatchObject({
      status: "completed",
      haltReason: null,
    });
  });

  it("a suspended organization's campaign is paused before anything is sent, and resumes on reinstatement", async () => {
    const s = await setup(3);
    await db
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.id, s.org.id));
    const t = new ScriptedTransport();
    const d = deps(t);
    await dispatchDue(d);
    const r = await sendBatch(d, await row(s.campaign.id));
    expect(r.halted).toBe("org_suspended");
    expect(t.sent).toHaveLength(0);
    expect(await row(s.campaign.id)).toMatchObject({
      status: "paused",
      haltReason: "org_suspended",
    });
    expect((await resumeDailyLimited(d)).resumed).toBe(0);
    await db
      .update(organizations)
      .set({ suspendedAt: null })
      .where(eq(organizations.id, s.org.id));
    expect((await resumeDailyLimited(d)).resumed).toBeGreaterThanOrEqual(1);
    await drain(d, s.campaign);
    expect(t.sent).toHaveLength(3);
  });

  it("refuses to send when the sender's domain is no longer verified", async () => {
    const s = await setup(2);
    const t = new ScriptedTransport();
    const d = deps(t);
    await dispatchDue(d);
    await db
      .update(senderDomains)
      .set({ status: "failed" })
      .where(eq(senderDomains.organizationId, s.org.id));
    const r = await sendBatch(d, await row(s.campaign.id));
    expect(r.halted).toBe("sender_unverified");
    expect(t.sent).toHaveLength(0);
    expect(await row(s.campaign.id)).toMatchObject({
      status: "paused",
      haltReason: "sender_unverified",
    });
  });

  it("an account-level provider error pauses the campaign and gives the rows back", async () => {
    const s = await setup(3);
    const t = new ScriptedTransport(() => ({
      ok: false,
      retryable: false,
      code: "SendingPausedException",
      message: "paused",
    }));
    const d = deps(t, { concurrency: 1 });
    await dispatchDue(d);
    const r = await sendBatch(d, await row(s.campaign.id));
    expect(r.halted).toBe("provider_SendingPausedException");
    const recs = await recipients(s.campaign.id);
    expect(recs.every((x) => x.status === "queued")).toBe(true);
    expect(await row(s.campaign.id)).toMatchObject({ status: "paused" });
  });

  it("a crashed worker's claim is recovered", async () => {
    const s = await setup(1);
    const t = new ScriptedTransport();
    const d = deps(t);
    await dispatchDue(d);
    await db
      .update(campaignRecipients)
      .set({ status: "sending", claimedAt: new Date(clock.getTime() - 3600_000) })
      .where(eq(campaignRecipients.campaignId, s.campaign.id));
    await drain(d, s.campaign);
    expect(t.sent).toHaveLength(1);
  });

  it("auto-pauses on bounce and complaint rates only once there is enough volume", async () => {
    const s = await setup(0);
    const fake = (n: number, status: string) =>
      Array.from({ length: n }, (_, i) => ({
        organizationId: s.org.id,
        campaignId: s.campaign.id,
        email: `h${status}${i}-${randomUUID().slice(0, 4)}@example.org`,
        status,
        sentAt: new Date(),
      }));
    await db
      .insert(campaignRecipients)
      .values([...fake(HEALTH.minSent - 9, "delivered"), ...fake(9, "bounced")]);
    expect(await evaluateHealth({ db }, s.campaign)).toBeNull(); // 9% < 10%
    await db
      .insert(campaignRecipients)
      .values(fake(1, "bounced").concat(fake(1, "bounced"), fake(1, "bounced")));
    expect(await evaluateHealth({ db }, s.campaign)).toBe("bounce_rate");
    const s2 = await setup(0);
    await db.insert(campaignRecipients).values([
      ...Array.from({ length: 150 }, (_, i) => ({
        organizationId: s2.org.id,
        campaignId: s2.campaign.id,
        email: `c${i}-${randomUUID().slice(0, 4)}@example.org`,
        status: "delivered",
        sentAt: new Date(),
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        organizationId: s2.org.id,
        campaignId: s2.campaign.id,
        email: `x${i}-${randomUUID().slice(0, 4)}@example.org`,
        status: "complained",
        sentAt: new Date(),
      })),
    ]);
    expect(await evaluateHealth({ db }, s2.campaign)).toBe("complaint_rate");
    const s3 = await setup(0);
    await db.insert(campaignRecipients).values(
      Array.from({ length: 10 }, (_, i) => ({
        organizationId: s3.org.id,
        campaignId: s3.campaign.id,
        email: `y${i}-${randomUUID().slice(0, 4)}@example.org`,
        status: "bounced",
        sentAt: new Date(),
      })),
    );
    expect(await evaluateHealth({ db }, s3.campaign)).toBeNull(); // 100% but tiny volume
  });

  it("a contact's name cannot inject a header line into the subject", async () => {
    const s = await setup(0);
    await createContact(db, s.oid, {
      email: `inj-${randomUUID().slice(0, 5)}@example.org`,
      firstName: "Ali\r\nBcc: evil@x.com",
    });
    const t = new ScriptedTransport();
    const d = deps(t);
    await dispatchDue(d);
    await drain(d, s.campaign);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.subject).not.toMatch(/[\r\n]/);
    expect(t.sent[0]!.subject).toContain("Ali");
  });

  it("only sends what is due and keeps tenants apart", async () => {
    const a = await setup(2);
    const b = await setup(2);
    await db
      .update(campaigns)
      .set({ scheduledAt: new Date("2030-01-01T00:00:00Z") })
      .where(eq(campaigns.id, b.campaign.id));
    const t = new ConsoleTransport(() => {});
    scopeOrg = a.org.id;
    await tick(deps(t));
    expect((await row(a.campaign.id)).status).toBe("completed");
    expect((await row(b.campaign.id)).status).toBe("scheduled");
    expect(t.sent.every((m) => m.from.email.endsWith(a.domain))).toBe(true);
    expect(t.sent.some((m) => b.emails.includes(m.to))).toBe(false);
  });

  it("a campaign with no eligible recipients completes immediately", async () => {
    const s = await setup(0);
    await dispatchDue(deps(new ScriptedTransport()));
    expect(await row(s.campaign.id)).toMatchObject({ status: "completed" });
  });
});
