import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { devDeps } from "@/lib/developers/deps";
import { deleteWebhookFor, updateWebhookFor } from "@/lib/developers/service";

const patch = z.object({
  url: z.string().trim().max(500).optional(),
  events: z.array(z.string().max(60)).min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});
type Ctx = { params: Promise<{ id: string }> };

export function PATCH(request: Request, { params }: Ctx) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, patch);
    if ("response" in parsed) return parsed.response;
    const r = await updateWebhookFor(devDeps(), actor, id, parsed.data);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}

export function DELETE(request: Request, { params }: Ctx) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await deleteWebhookFor(devDeps(), actor, id);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
