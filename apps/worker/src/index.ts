import { Redis } from "ioredis";
import { getEnv } from "@mailory/config";

const HEARTBEAT_KEY = "mailory:worker:heartbeat";
const env = getEnv();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Queue processors are registered here as phases ship (send, ses-events, import...).
// The heartbeat lets the platform admin panel show whether a worker is alive.
async function beat() {
  await redis.set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 60);
}

const timer = setInterval(() => {
  beat().catch((error) => console.error("[worker] heartbeat failed", error));
}, 15_000);
await beat();
console.log("[worker] started");

async function shutdown() {
  clearInterval(timer);
  await redis.quit();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
