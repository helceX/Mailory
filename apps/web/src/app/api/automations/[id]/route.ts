import { NextResponse } from "next/server";
import { z } from "zod";
import { updateAutomationSchema } from "@mailory/validation";
import { parseJson, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { automationDeps } from "@/lib/automations/deps";
import {
  deleteAutomationFor,
  getAutomationFor,
  updateAutomationFor,
} from "@/lib/automations/service";

type Params = { params: Promise<{ id: string }> };
const bad = () => serviceFailure({ code: "not_found" });

export function GET(request: Request, { params }: Params) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return bad();
    const r = await getAutomationFor(automationDeps(), actor, id);
    if (!r.ok) return serviceFailure(r);
    const { ok: _ok, ...body } = r;
    return NextResponse.json(body);
  });
}
export function PATCH(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, 200_000);
    if (big) return big;
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return bad();
    const parsed = await parseJson(request, updateAutomationSchema);
    if ("response" in parsed) return parsed.response;
    const r = await updateAutomationFor(automationDeps(), actor, id, parsed.data);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
export function DELETE(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return bad();
    const r = await deleteAutomationFor(automationDeps(), actor, id);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
