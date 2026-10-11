import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import { runRetention, type Database } from "@mailory/db";

export const RETENTION_QUEUE = "retention";
export const RETENTION_CRON = "0 4 * * *"; // 04:00 UTC, after the engagement refresh

/** Daily privacy housekeeping: expires old events/sessions and purges workspaces whose deletion grace is over. */
export async function startRetention(options: {
  redis: Redis;
  db: Database;
  pattern?: string;
  log?: (message: string, data?: unknown) => void;
}) {
  const dup = () =>
    options.redis.duplicate({
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions;
  const queue = new Queue(RETENTION_QUEUE, { connection: dup() });
  await queue.upsertJobScheduler(
    "retention-daily",
    { pattern: options.pattern ?? RETENTION_CRON, tz: "UTC" },
    { name: "sweep", opts: { removeOnComplete: 10, removeOnFail: 30 } },
  );
  const worker = new Worker(
    RETENTION_QUEUE,
    async () => {
      const result = await runRetention(options.db, new Date());
      options.log?.("retention swept", result);
      return result;
    },
    { connection: dup(), concurrency: 1 },
  );
  worker.on("failed", (job, error) =>
    console.error(`[worker] retention ${job?.id} failed`, error),
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
