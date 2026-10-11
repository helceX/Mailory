import { NextResponse } from "next/server";
import { createAutomationSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { automationDeps } from "@/lib/automations/deps";
import { createAutomationFor, listAutomationsFor } from "@/lib/automations/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await listAutomationsFor(automationDeps(), actor);
    return r.ok ? NextResponse.json({ automations: r.automations }) : serviceFailure(r);
  });
}
export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, createAutomationSchema);
    if ("response" in parsed) return parsed.response;
    const r = await createAutomationFor(automationDeps(), actor, parsed.data);
    return r.ok ? NextResponse.json({ id: r.id }, { status: 201 }) : serviceFailure(r);
  });
}
