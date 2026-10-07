import { NextResponse } from "next/server";
import { z } from "zod";
import { contactPatchSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { bulkAction, getContactDetail, updateContactFor } from "@/lib/audience/service";

type Params = { params: Promise<{ id: string }> };
const notFound = () => serviceFailure({ code: "not_found" });

export function GET(request: Request, { params }: Params) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await getContactDetail(audienceDeps(), actor, id);
    return result.ok
      ? NextResponse.json({ contact: result.contact })
      : serviceFailure(result);
  });
}

export function PATCH(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const parsed = await parseJson(request, contactPatchSchema);
    if ("response" in parsed) return parsed.response;
    const result = await updateContactFor(audienceDeps(), actor, id, parsed.data);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}

export function DELETE(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await bulkAction(audienceDeps(), actor, {
      action: "delete",
      ids: [id],
    });
    if (!result.ok) return serviceFailure(result);
    return result.affected ? NextResponse.json({ status: "ok" }) : notFound();
  });
}
