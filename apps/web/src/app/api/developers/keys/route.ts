import { NextResponse } from "next/server";
import { z } from "zod";
import { API_KEY_SCOPES } from "@mailory/core";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { devDeps } from "@/lib/developers/deps";
import { createApiKeyFor, developerOverviewFor } from "@/lib/developers/service";

const body = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(API_KEY_SCOPES),
});

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await developerOverviewFor(devDeps(), actor);
    return r.ok
      ? NextResponse.json({ keys: r.keys, webhooks: r.endpoints, quota: r.quota })
      : serviceFailure(r);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const r = await createApiKeyFor(devDeps(), actor, parsed.data);
    return r.ok
      ? NextResponse.json({ id: r.id, key: r.key, prefix: r.prefix }, { status: 201 })
      : serviceFailure(r);
  });
}
