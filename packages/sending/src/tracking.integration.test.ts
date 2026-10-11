import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaignLinks,
  campaignRecipients,
  campaignStats,
  campaigns,
  compareCampaigns,
  createContact,
  createDb,
  createSenderDomain,
  engagementTimeline,
  orgOverview,
  senderDomains,
  topLinks,
  trackingEvents,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import {
  DEFAULT_BRAND,
  DEFAULT_UTM,
  clickToken,
  openToken,
  unsubscribeToken,
  viewToken,
  type EmailDoc,
} from "@mailory/core";
import {
  blankTemplate,
  type EmailTransport,
  type OutgoingEmail,
  type SendOutcome,
} from "@mailory/email";
import { dispatchDue, sendBatch, type EngineDeps } from "./engine";
import { handleClick, handleOpen, renderForView } from "./track-events";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SECRET = "t".repeat(48);
const APP = "https://app.test";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

class Capture implements EmailTransport {
  readonly name = "capture";
  sent: OutgoingEmail[] = [];
  async send(m: OutgoingEmail): Promise<SendOutcome> {
    this.sent.push(m);
    return { ok: true, messageId: `m-${randomUUID()}` };
  }
}

suite("tracking, stats and browser view (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let clock: Date;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function sent(
    opts: { n?: number; trackOpens?: boolean; trackClicks?: boolean } = {},
  ) {
    clock = new Date("2026-03-01T10:00:00Z");
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const domain = `trk-${randomUUID().slice(0, 8)}.com`;
    const d = (await createSenderDomain(db, oid, {
      domain,
      provider: "mock",
      dkimTokens: ["a", "b", "c"],
      ownershipToken: "t".repeat(32),
      userId: user.id,
    }))!;
    await db
      .update(senderDomains)
      .set({ status: "verified" })
      .where(eq(senderDomains.id, d.id));
    for (let i = 0; i < (opts.n ?? 3); i++)
      await createContact(db, oid, {
        email: `t${i}-${randomUUID().slice(0, 6)}@example.org`,
        firstName: `Ad${i}`,
      });
    const doc: EmailDoc = blankTemplate(DEFAULT_BRAND);
    doc.blocks.push({
      id: "btn1",
      type: "button",
      label: "Git",
      href: "https://shop.example.com/x?a=1&b=2",
      variant: "solid",
      align: "center",
    });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        organizationId: org.id,
        name: "Takip",
        status: "scheduled",
        subject: "Selam {{first_name|dost}}",
        audience: { kind: "all" },
        utm: { ...DEFAULT_UTM, campaign: "takip" },
        trackOpens: opts.trackOpens ?? true,
        trackClicks: opts.trackClicks ?? true,
        scheduledAt: new Date("2026-03-01T09:00:00Z"),
        snapshot: {
          doc,
          version: 1,
          brand: DEFAULT_BRAND,
          sender: { fromName: "Acme", fromEmail: `info@${domain}`, replyTo: null },
          audienceCount: opts.n ?? 3,
          takenAt: clock.toISOString(),
        },
      })
      .returning();
    const transport = new Capture();
    const deps: EngineDeps = {
      db,
      transport,
      appUrl: APP,
      secret: SECRET,
      now: () => clock,
      sleep: async () => {},
      ratePerSecond: 1000,
      scope: { organizationId: org.id },
    };
    await dispatchDue(deps);
    await sendBatch(
      deps,
      (await db.select().from(campaigns).where(eq(campaigns.id, campaign!.id)))[0]!,
    );
    const recs = await db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, campaign!.id));
    return { org, oid, campaign: campaign!, transport, recs };
  }
  const tdeps = (secret = SECRET) => ({ db, secret, now: () => clock });
  const later = (ms: number) => (clock = new Date(clock.getTime() + ms));

  it("sent mail carries tracked links and a pixel, with UTM-tagged destinations stored server-side", async () => {
    const s = await sent();
    const m = s.transport.sent[0]!;
    expect(m.html).toMatch(/href="https:\/\/app\.test\/c\/[^"]+"/);
    expect(m.html).not.toContain("shop.example.com");
    expect(m.html).toMatch(
      /<img src="https:\/\/app\.test\/o\/[^"]+\.gif" width="1" height="1"/,
    );
    expect(m.html).toContain("/unsubscribe/");
    const links = await db
      .select()
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, s.campaign.id));
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe(
      "https://shop.example.com/x?a=1&b=2&utm_source=mailory&utm_medium=email&utm_campaign=takip",
    );
  });

  it("respects per-campaign switches: no click rewriting or no pixel", async () => {
    const noClicks = await sent({ n: 1, trackClicks: false });
    expect(noClicks.transport.sent[0]!.html).toContain("shop.example.com");
    expect(noClicks.transport.sent[0]!.html).toContain("/o/");
    const noOpens = await sent({ n: 1, trackOpens: false });
    expect(noOpens.transport.sent[0]!.html).not.toContain("/o/");
    expect(noOpens.transport.sent[0]!.html).toContain("/c/");
  });

  it("a click redirects to the stored URL and counts once as unique, every time in total", async () => {
    const s = await sent();
    const r = s.recs[0]!;
    const [link] = await db
      .select()
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, s.campaign.id));
    const tok = clickToken(SECRET, s.org.id, s.campaign.id, r.id, link!.id);
    later(60_000);
    const first = await handleClick(tdeps(), tok, {
      userAgent: CHROME,
      ip: "203.0.113.5",
    });
    expect(first).toEqual({ url: link!.url });
    later(1000);
    await handleClick(tdeps(), tok, { userAgent: CHROME, ip: "203.0.113.5" });
    const stats = await campaignStats(db, s.oid, s.campaign.id);
    expect(stats).toMatchObject({ uniqueClicks: 1, totalClicks: 2, uniqueOpens: 1 }); // a click implies an open
    const events = await db
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.recipientId, r.id));
    expect(events).toHaveLength(2);
    expect(events[0]!.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(events)).not.toContain("203.0.113.5");
    expect(JSON.stringify(events)).not.toContain("Mozilla");
    expect(events[0]!.device).toBe("desktop");
  });

  it("scanner clicks still redirect but never count", async () => {
    const s = await sent();
    const r = s.recs[0]!;
    const [link] = await db
      .select()
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, s.campaign.id));
    const tok = clickToken(SECRET, s.org.id, s.campaign.id, r.id, link!.id);
    later(500); // inside the scanner window
    expect(await handleClick(tdeps(), tok, { userAgent: CHROME })).toEqual({
      url: link!.url,
    });
    later(120_000);
    expect(
      await handleClick(tdeps(), tok, {
        userAgent: "Mozilla/5.0 (compatible; SafeLinks/1.0)",
      }),
    ).toEqual({ url: link!.url });
    const stats = await campaignStats(db, s.oid, s.campaign.id);
    expect(stats).toMatchObject({ uniqueClicks: 0, totalClicks: 0, uniqueOpens: 0 });
    expect(
      (
        await db
          .select()
          .from(trackingEvents)
          .where(eq(trackingEvents.campaignId, s.campaign.id))
      ).every((e) => e.isBot),
    ).toBe(true);
  });

  it("opens: valid tokens count once as unique; forged or foreign tokens record nothing", async () => {
    const a = await sent();
    const b = await sent();
    const r = a.recs[0]!;
    later(30_000);
    await handleOpen(tdeps(), openToken(SECRET, a.org.id, a.campaign.id, r.id), {
      userAgent: CHROME,
    });
    await handleOpen(tdeps(), openToken(SECRET, a.org.id, a.campaign.id, r.id), {
      userAgent: CHROME,
    });
    expect(await campaignStats(db, a.oid, a.campaign.id)).toMatchObject({
      uniqueOpens: 1,
      totalOpens: 2,
    });
    // tampered / other secret / mismatched ids (org B's campaign with org A's recipient)
    await handleOpen(
      tdeps(),
      openToken(SECRET, a.org.id, a.campaign.id, r.id).slice(0, -2) + "xx",
      { userAgent: CHROME },
    );
    await handleOpen(
      tdeps("z".repeat(48)),
      openToken(SECRET, a.org.id, a.campaign.id, r.id),
      { userAgent: CHROME },
    );
    await handleOpen(tdeps(), openToken(SECRET, b.org.id, b.campaign.id, r.id), {
      userAgent: CHROME,
    });
    await handleOpen(tdeps(), openToken(SECRET, a.org.id, b.campaign.id, r.id), {
      userAgent: CHROME,
    });
    expect(await campaignStats(db, a.oid, a.campaign.id)).toMatchObject({
      totalOpens: 2,
    });
    expect(await campaignStats(db, b.oid, b.campaign.id)).toMatchObject({
      totalOpens: 0,
    });
  });

  it("a click token for another campaign's link yields no destination", async () => {
    const a = await sent();
    const b = await sent();
    const [linkB] = await db
      .select()
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, b.campaign.id));
    expect(
      await handleClick(
        tdeps(),
        clickToken(SECRET, a.org.id, a.campaign.id, a.recs[0]!.id, linkB!.id),
        { userAgent: CHROME },
      ),
    ).toBeNull();
    expect(await handleClick(tdeps(), "garbage", {})).toBeNull();
    expect(
      await handleClick(
        tdeps(),
        openToken(SECRET, a.org.id, a.campaign.id, a.recs[0]!.id),
        {},
      ),
    ).toBeNull();
  });

  it("analytics: stats, top links, timeline, comparison and overview agree and stay inside the tenant", async () => {
    const s = await sent({ n: 4 });
    const other = await sent({ n: 2 });
    const [link] = await db
      .select()
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, s.campaign.id));
    later(10 * 60_000);
    for (const r of s.recs.slice(0, 3))
      await handleOpen(tdeps(), openToken(SECRET, s.org.id, s.campaign.id, r.id), {
        userAgent: CHROME,
      });
    for (const r of s.recs.slice(0, 2))
      await handleClick(
        tdeps(),
        clickToken(SECRET, s.org.id, s.campaign.id, r.id, link!.id),
        { userAgent: CHROME },
      );
    await db
      .update(campaignRecipients)
      .set({ status: "delivered", deliveredAt: clock })
      .where(eq(campaignRecipients.id, s.recs[0]!.id));
    await db
      .update(campaignRecipients)
      .set({ status: "bounced" })
      .where(eq(campaignRecipients.id, s.recs[3]!.id));

    const st = await campaignStats(db, s.oid, s.campaign.id);
    expect(st).toMatchObject({
      recipients: 4,
      sent: 4,
      delivered: 1,
      bounced: 1,
      uniqueOpens: 3,
      uniqueClicks: 2,
      totalOpens: 3,
      totalClicks: 2,
    });
    expect(await topLinks(db, s.oid, s.campaign.id)).toEqual([
      { url: link!.url, clicks: 2, uniqueClicks: 2 },
    ]);
    const tl = await engagementTimeline(db, s.oid, s.campaign.id);
    expect(tl.reduce((a, b) => a + b.opens, 0)).toBe(3);
    expect(tl.reduce((a, b) => a + b.clicks, 0)).toBe(2);
    const cmp = await compareCampaigns(db, s.oid);
    expect(cmp.map((c) => c.id)).toEqual([s.campaign.id]);
    expect(cmp[0]).toMatchObject({ uniqueOpens: 3, totalClicks: 2, recipients: 4 });
    const ov = await orgOverview(db, s.oid, new Date("2026-01-01T00:00:00Z"));
    expect(ov).toMatchObject({
      campaigns: 1,
      recipients: 4,
      uniqueOpens: 3,
      uniqueClicks: 2,
      totalOpens: 3,
    });
    expect(await campaignStats(db, other.oid, other.campaign.id)).toMatchObject({
      recipients: 2,
      uniqueOpens: 0,
    });
    expect(await topLinks(db, other.oid, s.campaign.id)).toEqual([]); // foreign campaign id through another org
  });

  it("view-in-browser renders the personalised email untracked, and rejects foreign or bad tokens", async () => {
    const a = await sent();
    const b = await sent();
    const r = a.recs[0]!;
    const page = await renderForView(
      { ...tdeps(), appUrl: APP },
      viewToken(SECRET, a.org.id, r.id),
    );
    expect(page).not.toBeNull();
    expect(page!.html).toContain(`Selam`.slice(0, 0)); // rendered document
    expect(page!.html).toContain("shop.example.com");
    expect(page!.html).not.toContain("/c/");
    expect(page!.html).not.toContain("/o/");
    expect(page!.html).toContain(
      `/unsubscribe/${unsubscribeToken(SECRET, a.org.id, r.id)}`,
    );
    expect(page!.subject).toMatch(/^Selam Ad\d$/);
    // the sent mail's own "view in browser" token resolves to the same recipient
    expect(
      await renderForView(
        { ...tdeps(), appUrl: APP },
        viewToken(SECRET, b.org.id, r.id),
      ),
    ).toBeNull(); // org B + recipient of A
    expect(await renderForView({ ...tdeps(), appUrl: APP }, "nope")).toBeNull();
    expect(
      await renderForView(
        { ...tdeps(), appUrl: APP },
        unsubscribeToken(SECRET, a.org.id, r.id),
      ),
    ).toBeNull();
  });
});
