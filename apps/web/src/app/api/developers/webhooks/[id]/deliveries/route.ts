import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { devDeps } from "@/lib/developers/deps";
import { webhookDeliveriesFor } from "@/lib/developers/service";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await webhookDeliveriesFor(devDeps(), actor, id);
    return r.ok ? NextResponse.json({ deliveries: r.deliveries }) : serviceFailure(r);
  });
}
