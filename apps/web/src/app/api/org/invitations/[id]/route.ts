import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, failureResponse, requireActor } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { revokeInvitation } from "@/lib/org/service";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireActor();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return failureResponse("not_found");

  const result = await revokeInvitation(orgDeps(), auth.actor, id);
  return result.ok ? NextResponse.json({ status: "ok" }) : failureResponse(result.code);
}
