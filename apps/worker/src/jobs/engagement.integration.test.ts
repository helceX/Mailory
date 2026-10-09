import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { createDb, type Database } from "@mailory/db";
import { ENGAGEMENT_CRON, startEngagementRefresh } from "./engagement";

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suite = dbUrl && redisUrl ? describe : describe.skip;

suite("engagement-refresh job", () => {
  let db: Database;
  let end: () => Promise<void>;
  let redis: Redis;
  beforeAll(() => {
    const c = createDb(dbUrl!);
    db = c.db;
    end = () => c.pool.end();
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });
  });
  afterAll(async () => {
    await redis.quit();
    await end();
  });

  it("registers a nightly cron scheduler and a run completes", async () => {
    const job = await startEngagementRefresh({ redis, db });
    try {
      const sch = (await job.queue.getJobSchedulers()).find(
        (s) => s.key === "engagement-nightly",
      );
      expect(sch?.pattern).toBe(ENGAGEMENT_CRON);
      const queued = await job.queue.add("refresh", {});
      const result = await new Promise<{ updated: number }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("did not finish")), 15_000);
        job.worker.on("completed", (j, r) => {
          if (j.id === queued.id) {
            clearTimeout(t);
            resolve(r);
          }
        });
        job.worker.on("failed", (_j, e) => reject(e));
      });
      expect(typeof result.updated).toBe("number");
    } finally {
      await job.queue.removeJobScheduler("engagement-nightly");
      await job.close();
    }
  }, 30_000);
});
