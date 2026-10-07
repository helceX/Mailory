import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { deleteFieldFor } from "@/lib/audience/service";

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const result = await deleteFieldFor(audienceDeps(), actor, id);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
