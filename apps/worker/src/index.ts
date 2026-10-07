import { Redis } from "ioredis";
import { getEnv } from "@mailory/config";
import { createDb } from "@mailory/db";
import { createDnsResolver, createDomainProvider } from "@mailory/deliverability";
import { createEmailTransport } from "@mailory/sending";
import { startCampaignSend } from "./jobs/campaign-send";
import { startDomainCheck } from "./jobs/domain-check";

const HEARTBEAT_KEY = "mailory:worker:heartbeat";
const env = getEnv();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const { db, pool } = createDb(env.DATABASE_URL);

// The heartbeat lets the platform admin panel show whether a worker is alive.
async function beat() {
  await redis.set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 60);
}
const timer = setInterval(() => {
  beat().catch((error) => console.error("[worker] heartbeat failed", error));
}, 15_000);
await beat();

const resolver = createDnsResolver(env);
const domainCheck = await startDomainCheck({
  redis,
  deps: { db, resolver, provider: createDomainProvider(env, resolver) },
  log: (message, summary) =>
    console.log(`[worker] ${message}`, JSON.stringify(summary)),
});
const campaignSend = await startCampaignSend({
  redis,
  deps: {
    db,
    transport: createEmailTransport(env),
    appUrl: env.APP_URL.replace(/\/$/, ""),
    secret: env.SESSION_SECRET,
    ratePerSecond: env.SEND_RATE_PER_SECOND,
    log: (message, data) => console.log(`[worker] ${message}`, JSON.stringify(data)),
  },
  log: (message, data) => console.log(`[worker] ${message}`, JSON.stringify(data)),
});
console.log("[worker] started (domain-check, campaign-send scheduled)");

async function shutdown() {
  clearInterval(timer);
  await domainCheck.close();
  await campaignSend.close();
  await redis.quit();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
