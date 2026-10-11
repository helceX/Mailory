import { NextResponse } from "next/server";
import { z } from "zod";
import { senderIdentitySchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { senderDeps } from "@/lib/senders/deps";
import { removeIdentity, updateIdentity } from "@/lib/senders/service";

type Params = { params: Promise<{ id: string }> };
const notFound = () => serviceFailure({ code: "not_found" });

export function PATCH(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const parsed = await parseJson(request, senderIdentitySchema);
    if ("response" in parsed) return parsed.response;
    const result = await updateIdentity(senderDeps(), actor, id, parsed.data);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}

export function DELETE(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await removeIdentity(senderDeps(), actor, id);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
