import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  cleanupDormantFor,
  getCleanupFor,
  restoreCleanedFor,
} from "@/lib/deliverability/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await getCleanupFor({ db: getDb().db }, actor);
    return r.ok
      ? NextResponse.json({ candidates: r.candidates, cleaned: r.cleaned })
      : serviceFailure(r);
  });
}

const body = z.object({ action: z.enum(["clean", "restore"]) });

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const deps = { db: getDb().db };
    if (parsed.data.action === "clean") {
      const r = await cleanupDormantFor(deps, actor);
      return r.ok ? NextResponse.json({ cleaned: r.cleaned }) : serviceFailure(r);
    }
    const r = await restoreCleanedFor(deps, actor);
    return r.ok
      ? NextResponse.json({ restored: r.restored, limited: r.limited })
      : serviceFailure(r);
  });
}
