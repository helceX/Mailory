import { NextResponse } from "next/server";
import { z } from "zod";
import { nameSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { deleteListFor, updateListFor } from "@/lib/audience/service";

type Params = { params: Promise<{ id: string }> };
const notFound = () => serviceFailure({ code: "not_found" });

export function PATCH(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const parsed = await parseJson(request, nameSchema);
    if ("response" in parsed) return parsed.response;
    const result = await updateListFor(audienceDeps(), actor, id, parsed.data);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}

export function DELETE(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await deleteListFor(audienceDeps(), actor, id);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
