import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  createDb,
  createSenderDomain,
  senderDomains,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import {
  MockDnsResolver,
  MockDomainProvider,
  buildDnsRecords,
  type MockZone,
} from "@mailory/email";
import { DOMAIN_CHECK_QUEUE, startDomainCheck } from "./domain-check";

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = dbUrl && redisUrl ? describe : describe.skip;

suite("domain-check worker job (real Postgres + Redis)", () => {
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

  it("registers a repeating scheduler, and a sweep verifies a domain whose DNS has appeared", async () => {
    const owner = await createTestUser(db);
    const org = await createTestOrg(db, owner.id);
    const domain = `worker-${randomUUID().slice(0, 8)}.com`;
    const dkimTokens = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
    const ownershipToken = "f".repeat(32);
    const row = await createSenderDomain(db, asOrganizationId(org.id), {
      domain,
      provider: "mock",
      dkimTokens,
      ownershipToken,
      userId: owner.id,
    });
    if (!row) throw new Error("setup failed");

    // The customer has published everything.
    const zone: MockZone = {};
    for (const r of buildDnsRecords({ domain, dkimTokens, ownershipToken })) {
      const e = (zone[r.host] ??= {});
      if (r.type === "TXT") (e.TXT ??= []).push(r.value);
      else (e.CNAME ??= []).push(r.value);
    }
    const resolver = new MockDnsResolver(zone);

    const job = await startDomainCheck({
      redis,
      deps: { db, resolver, provider: new MockDomainProvider(resolver) },
      everyMs: 3_600_000,
      sweep: { organizationId: org.id },
    });
    try {
      const schedulers = await job.queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key)).toContain("domain-sweep");
      expect(schedulers.find((s) => s.key === "domain-sweep")?.every).toBe(3_600_000);

      // The scheduler's first job fires immediately; either it or a manual sweep verifies the domain. Wait for the outcome.
      await job.queue.add("sweep", {});
      const deadline = Date.now() + 15_000;
      let status = "pending";
      while (Date.now() < deadline) {
        const [cur] = await db
          .select({ status: senderDomains.status })
          .from(senderDomains)
          .where(eq(senderDomains.id, row.id));
        status = cur!.status;
        if (status === "verified") break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(status).toBe("verified");
      const [after] = await db
        .select()
        .from(senderDomains)
        .where(eq(senderDomains.id, row.id));
      expect(after).toMatchObject({
        status: "verified",
        ownershipOk: true,
        dkimOk: true,
      });
    } finally {
      await job.queue.removeJobScheduler("domain-sweep");
      await job.close();
    }
    expect(DOMAIN_CHECK_QUEUE).toBe("domain-check");
  }, 40_000);
});
