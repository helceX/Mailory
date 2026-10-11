import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { aiDeps } from "@/lib/ai/deps";
import { setAiEnabledFor } from "@/lib/ai/service";

export function PUT(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, z.object({ enabled: z.boolean() }));
    if ("response" in parsed) return parsed.response;
    const r = await setAiEnabledFor(aiDeps(), actor, parsed.data.enabled);
    return r.ok ? NextResponse.json({ enabled: r.enabled }) : serviceFailure(r);
  });
}
