import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import { tick, type EngineDeps } from "@mailory/sending";

export const CAMPAIGN_SEND_QUEUE = "campaign-send";
export const TICK_EVERY_MS = 15_000;

/**
 * The send engine's heartbeat: every few seconds start due campaigns and push the sending ones forward. Ticks are
 * serialized per worker (concurrency 1); several workers may run side by side because recipient claims are
 * row-locked and campaign starts are compare-and-set.
 */
export async function startCampaignSend(options: {
  redis: Redis;
  deps: EngineDeps;
  everyMs?: number;
  budgetMs?: number;
  log?: (message: string, data?: unknown) => void;
}) {
  const dup = () =>
    options.redis.duplicate({
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions;
  const queue = new Queue(CAMPAIGN_SEND_QUEUE, { connection: dup() });
  await queue.upsertJobScheduler(
    "campaign-tick",
    { every: options.everyMs ?? TICK_EVERY_MS },
    { name: "tick", opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );
  const worker = new Worker(
    CAMPAIGN_SEND_QUEUE,
    async () => {
      const summary = await tick(options.deps, options.budgetMs);
      if (summary.started || summary.sent || summary.resumed)
        options.log?.("campaign tick", summary);
      return summary;
    },
    { connection: dup(), concurrency: 1 },
  );
  worker.on("failed", (job, error) =>
    console.error(`[worker] campaign tick ${job?.id} failed`, error),
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
