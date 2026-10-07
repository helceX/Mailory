import { NextResponse } from "next/server";
import { Redis } from "ioredis";
import { checkDb, createDb } from "@mailory/db";
import { getEnv } from "@mailory/config";
import { runChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Readiness: database and Redis reachable. Returns 503 otherwise. */
export async function GET() {
  const env = getEnv();
  const { pool } = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
  });
  try {
    const result = await runChecks({
      database: () => checkDb(pool),
      redis: async () => {
        await redis.connect();
        return (await redis.ping()) === "PONG";
      },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } finally {
    redis.disconnect();
    await pool.end().catch(() => undefined);
  }
}
