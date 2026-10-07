import { NextResponse } from "next/server";
import { z } from "zod";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { aiDeps } from "@/lib/ai/deps";
import { draftEmailFor } from "@/lib/ai/service";

const schema = z.object({
  brief: z.string().trim().min(10, "Kısa bir açıklama yazın.").max(2000),
  tone: z.enum(["samimi", "profesyonel", "enerjik", "sade"]).default("samimi"),
});

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const limited = await limit(`ai:${actor.organizationId}`, 10, 60);
    if (limited) return limited;
    const parsed = await parseJson(request, schema);
    if ("response" in parsed) return parsed.response;
    const r = await draftEmailFor(aiDeps(), actor, parsed.data);
    return r.ok ? NextResponse.json({ title: r.title, doc: r.doc }) : serviceFailure(r);
  });
}
