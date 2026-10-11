import { NextResponse } from "next/server";
import { checkDb } from "@mailory/db";
import { getDb } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { runChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Readiness: database and Redis reachable. Returns 503 otherwise. */
export async function GET() {
  const result = await runChecks({
    database: () => checkDb(getDb().pool),
    redis: async () => (await getRedis().ping()) === "PONG",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
