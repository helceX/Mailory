import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { devDeps } from "@/lib/developers/deps";
import { createWebhookFor } from "@/lib/developers/service";

const body = z.object({
  url: z.string().trim().max(500),
  events: z.array(z.string().max(60)).min(1).max(20),
});

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const r = await createWebhookFor(devDeps(), actor, parsed.data);
    return r.ok
      ? NextResponse.json({ id: r.id, secret: r.secret }, { status: 201 })
      : serviceFailure(r);
  });
}
