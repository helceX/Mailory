import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  createContact,
  createDb,
  createSenderDomain,
  senderDomains,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_BRAND, DEFAULT_UTM } from "@mailory/core";
import { ConsoleTransport, blankTemplate } from "@mailory/email";
import { CAMPAIGN_SEND_QUEUE, startCampaignSend } from "./campaign-send";

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = dbUrl && redisUrl ? describe : describe.skip;

suite("campaign-send worker job (real Postgres + Redis)", () => {
  let db: Database;
  let endDb: () => Promise<void>;
  let redis: Redis;
  beforeAll(() => {
    const c = createDb(dbUrl!);
    db = c.db;
    endDb = () => c.pool.end();
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });
  });
  afterAll(async () => {
    await redis.quit();
    await endDb();
  });

  it("the scheduler picks up a due campaign and delivers it to every subscribed contact", async () => {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const domain = `wk-${randomUUID().slice(0, 8)}.com`;
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
    for (let i = 0; i < 3; i++)
      await createContact(db, oid, {
        email: `w${i}-${randomUUID().slice(0, 5)}@example.org`,
      });
    const [camp] = await db
      .insert(campaigns)
      .values({
        organizationId: org.id,
        name: "Worker",
        status: "scheduled",
        subject: "Selam",
        audience: { kind: "all" },
        utm: DEFAULT_UTM,
        scheduledAt: new Date(Date.now() - 1000),
        snapshot: {
          doc: blankTemplate(DEFAULT_BRAND),
          version: 1,
          brand: DEFAULT_BRAND,
          sender: { fromName: "Acme", fromEmail: `info@${domain}`, replyTo: null },
          audienceCount: 3,
          takenAt: new Date().toISOString(),
        },
      })
      .returning();

    const transport = new ConsoleTransport(() => {});
    const job = await startCampaignSend({
      redis,
      deps: {
        db,
        transport,
        appUrl: "https://app.test",
        secret: "k".repeat(48),
        ratePerSecond: 500,
        scope: { organizationId: org.id },
      },
      everyMs: 500,
    });
    try {
      const schedulers = await job.queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key)).toContain("campaign-tick");
      const deadline = Date.now() + 20_000;
      let status = "scheduled";
      while (Date.now() < deadline) {
        status = (
          await db
            .select({ s: campaigns.status })
            .from(campaigns)
            .where(eq(campaigns.id, camp!.id))
        )[0]!.s;
        if (status === "completed") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(status).toBe("completed");
      expect(transport.sent).toHaveLength(3);
      const recs = await db
        .select()
        .from(campaignRecipients)
        .where(eq(campaignRecipients.campaignId, camp!.id));
      expect(recs.every((r) => r.status === "sent")).toBe(true);
    } finally {
      await job.queue.removeJobScheduler("campaign-tick");
      await job.close();
    }
    expect(CAMPAIGN_SEND_QUEUE).toBe("campaign-send");
  }, 40_000);
});
