import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { aiDeps } from "@/lib/ai/deps";
import { saveAiDraftFor } from "@/lib/ai/service";

const schema = z.object({ title: z.string().trim().min(1).max(120), doc: z.unknown() });

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, 300_000);
    if (big) return big;
    const parsed = await parseJson(request, schema);
    if ("response" in parsed) return parsed.response;
    const r = await saveAiDraftFor(aiDeps(), actor, parsed.data);
    return r.ok ? NextResponse.json({ id: r.id }, { status: 201 }) : serviceFailure(r);
  });
}
