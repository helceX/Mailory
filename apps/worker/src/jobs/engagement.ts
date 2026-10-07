import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import { refreshEngagement, type Database } from "@mailory/db";

export const ENGAGEMENT_QUEUE = "engagement-refresh";
export const ENGAGEMENT_CRON = "0 3 * * *"; // 03:00 UTC, quiet hours for Turkey

/** Nightly recompute of contact engagement scores. Idempotent, so a missed or doubled run is harmless. */
export async function startEngagementRefresh(options: {
  redis: Redis;
  db: Database;
  pattern?: string;
  log?: (message: string, data?: unknown) => void;
}) {
  const dup = () =>
    options.redis.duplicate({
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions;
  const queue = new Queue(ENGAGEMENT_QUEUE, { connection: dup() });
  await queue.upsertJobScheduler(
    "engagement-nightly",
    { pattern: options.pattern ?? ENGAGEMENT_CRON, tz: "UTC" },
    { name: "refresh", opts: { removeOnComplete: 10, removeOnFail: 30 } },
  );
  const worker = new Worker(
    ENGAGEMENT_QUEUE,
    async () => {
      const result = await refreshEngagement(options.db, new Date());
      options.log?.("engagement refreshed", result);
      return result;
    },
    { connection: dup(), concurrency: 1 },
  );
  worker.on("failed", (job, error) =>
    console.error(`[worker] engagement ${job?.id} failed`, error),
  );
  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
