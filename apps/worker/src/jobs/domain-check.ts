import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import {
  sweepDomains,
  type CheckDeps,
  type SweepSummary,
} from "@mailory/deliverability";

export const DOMAIN_CHECK_QUEUE = "domain-check";
export const SWEEP_EVERY_MS = 5 * 60_000;

/**
 * Re-checks sender domains in the background: new domains until their DNS appears, verified domains daily (and every
 * 15 minutes while one is failing), so a broken record is noticed without anyone pressing a button. The sweep decides
 * which domains are due; this schedule only has to wake it up regularly.
 */
export async function startDomainCheck(options: {
  redis: Redis;
  deps: CheckDeps;
  everyMs?: number;
  sweep?: { limit?: number; organizationId?: string };
  log?: (message: string, summary?: SweepSummary) => void;
}) {
  // BullMQ needs its own blocking connections; duplicate() reuses the settings of the shared client.
  const connection = options.redis.duplicate({
    maxRetriesPerRequest: null,
  }) as unknown as ConnectionOptions;
  const queue = new Queue(DOMAIN_CHECK_QUEUE, { connection });
  await queue.upsertJobScheduler(
    "domain-sweep",
    { every: options.everyMs ?? SWEEP_EVERY_MS },
    { name: "sweep", opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );

  const worker = new Worker<unknown, SweepSummary>(
    DOMAIN_CHECK_QUEUE,
    async () => {
      const summary = await sweepDomains(options.deps, options.sweep);
      options.log?.("domain sweep", summary);
      return summary;
    },
    // One sweep at a time: two overlapping sweeps would just duplicate DNS lookups.
    {
      connection: options.redis.duplicate({
        maxRetriesPerRequest: null,
      }) as unknown as ConnectionOptions,
      concurrency: 1,
    },
  );
  worker.on("failed", (job, error) =>
    console.error(`[worker] domain sweep ${job?.id} failed`, error),
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
