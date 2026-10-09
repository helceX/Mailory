import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { automationDeps } from "@/lib/automations/deps";
import { pauseAutomationFor } from "@/lib/automations/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await pauseAutomationFor(automationDeps(), actor, id);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
