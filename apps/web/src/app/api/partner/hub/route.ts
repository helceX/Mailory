import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { listHubFor, publishToHubFor } from "@/lib/partner/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await listHubFor(orgDeps(), actor);
    return r.ok
      ? NextResponse.json({
          templates: r.templates.map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            description: t.description,
            createdAt: t.createdAt,
          })),
        })
      : serviceFailure(r);
  });
}
export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(
      request,
      z.object({
        templateId: z.string().uuid(),
        description: z.string().trim().max(300).nullish(),
      }),
    );
    if ("response" in parsed) return parsed.response;
    const r = await publishToHubFor(orgDeps(), actor, {
      templateId: parsed.data.templateId,
      description: parsed.data.description ?? null,
    });
    return r.ok ? NextResponse.json({ id: r.id }, { status: 201 }) : serviceFailure(r);
  });
}
