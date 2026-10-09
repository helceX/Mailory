import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import { automationTick, type AutomationDeps } from "@mailory/sending";

export const AUTOMATION_QUEUE = "automation-tick";
export const AUTOMATION_EVERY_MS = 30_000;

/** Enrols new triggers and advances due enrolments. Emails themselves go out through the normal campaign-send tick. */
export async function startAutomation(options: {
  redis: Redis;
  deps: AutomationDeps;
  everyMs?: number;
  log?: (message: string, data?: unknown) => void;
}) {
  const dup = () =>
    options.redis.duplicate({
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions;
  const queue = new Queue(AUTOMATION_QUEUE, { connection: dup() });
  await queue.upsertJobScheduler(
    "automation-tick",
    { every: options.everyMs ?? AUTOMATION_EVERY_MS },
    { name: "tick", opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );
  const worker = new Worker(
    AUTOMATION_QUEUE,
    async () => {
      const s = await automationTick(options.deps);
      if (s.enrolled || s.processed) options.log?.("automation tick", s);
      return s;
    },
    { connection: dup(), concurrency: 1 },
  );
  worker.on("failed", (job, error) =>
    console.error(`[worker] automation ${job?.id} failed`, error),
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
