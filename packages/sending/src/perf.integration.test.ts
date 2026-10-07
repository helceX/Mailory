import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  asOrganizationId,
  campaignStats,
  campaigns,
  createDb,
  createSenderDomain,
  materializeRecipients,
  orgOverview,
  senderDomains,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_BRAND, DEFAULT_UTM } from "@mailory/core";
import { blankTemplate, type EmailTransport, type SendOutcome } from "@mailory/email";
import { sendBatch, type EngineDeps } from "./engine";

/** Opt-in (PERF=1): the "100k recipients" launch requirement, on real Postgres with a no-op transport. */
const suite = process.env.DATABASE_URL && process.env.PERF ? describe : describe.skip;
const N = Number(process.env.PERF_RECIPIENTS ?? 100_000);

class NullTransport implements EmailTransport {
  readonly name = "null";
  count = 0;
  async send(): Promise<SendOutcome> {
    this.count++;
    return { ok: true, messageId: `m-${randomUUID()}` };
  }
}

suite(`campaign performance @ ${N} recipients`, () => {
  let db: Database;
  let end: () => Promise<void>;
  const timings: Record<string, number> = {};
  const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await fn();
    timings[label] = Math.round(performance.now() - start);
    return result;
  };
  beforeAll(() => {
    const c = createDb(process.env.DATABASE_URL!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => {
    console.log(`[perf] campaign @ ${N}:`, JSON.stringify(timings));
    await end();
  });

  it("materializes, sends a sample and aggregates analytics within budget", async () => {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const domain = `perf-${randomUUID().slice(0, 8)}.com`;
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
    await time("seed contacts", () =>
      db.execute(sql`insert into contacts (organization_id, email, first_name, status, consent_status)
        select ${org.id}::uuid, 'p' || g || '@perf.example.org', 'Ad' || g, 'subscribed', 'granted' from generate_series(1, ${N}) g`),
    );
    const now = new Date();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        organizationId: org.id,
        name: "Perf",
        status: "sending",
        subject: "Merhaba {{first_name|dost}}",
        audience: { kind: "all" },
        utm: DEFAULT_UTM,
        scheduledAt: now,
        snapshot: {
          doc: blankTemplate(DEFAULT_BRAND),
          version: 1,
          brand: DEFAULT_BRAND,
          sender: { fromName: "A", fromEmail: `info@${domain}`, replyTo: null },
          audienceCount: N,
          takenAt: now.toISOString(),
        },
      })
      .returning();
    const inserted = await time("materialize", () =>
      materializeRecipients(db, oid, campaign!.id, { kind: "all" } as never, now),
    );
    expect(Number(inserted)).toBeGreaterThanOrEqual(N);

    const transport = new NullTransport();
    const deps: EngineDeps = {
      scope: { organizationId: org.id },
      db,
      transport,
      appUrl: "https://app.test",
      secret: "s".repeat(48),
      now: () => now,
      sleep: async () => {},
      ratePerSecond: 100_000,
    };
    const SAMPLE = Math.min(N, 5_000);
    await time(`send ${SAMPLE} (render+claim+mark)`, async () => {
      while (transport.count < SAMPLE) {
        const r = await sendBatch(
          deps,
          (await db.select().from(campaigns).where(eq(campaigns.id, campaign!.id)))[0]!,
        );
        if (r.claimed === 0 || r.halted) break;
      }
    });
    timings["send msgs/sec"] = Math.round(
      transport.count / (timings[`send ${SAMPLE} (render+claim+mark)`]! / 1000),
    );
    await time("campaignStats", () => campaignStats(db, oid, campaign!.id));
    await time("orgOverview", () => orgOverview(db, oid, now));

    expect(timings["materialize"]!).toBeLessThan(60_000);
    expect(timings["campaignStats"]!).toBeLessThan(3_000);
  }, 600_000);
});
