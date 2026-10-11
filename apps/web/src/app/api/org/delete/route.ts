import { NextResponse } from "next/server";
import { z } from "zod";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requestOrganizationDeletionFor } from "@/lib/privacy/service";

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const limited = await limit(`org-delete:${actor.userId}`, 5, 3600);
    if (limited) return limited;
    const parsed = await parseJson(
      request,
      z.object({ confirmName: z.string().trim().min(1).max(200) }),
    );
    if ("response" in parsed) return parsed.response;
    const r = await requestOrganizationDeletionFor(
      { db: getDb().db },
      actor,
      parsed.data.confirmName,
    );
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
