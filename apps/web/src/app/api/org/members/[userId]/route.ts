import { NextResponse } from "next/server";
import { z } from "zod";
import { updateMemberRoleSchema } from "@mailory/validation";
import { assertSameOrigin, failureResponse, parseJson, requireActor } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { changeMemberRole, removeMember } from "@/lib/org/service";

type Params = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireActor();
  if ("response" in auth) return auth.response;
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) return failureResponse("not_found");
  const parsed = await parseJson(request, updateMemberRoleSchema);
  if ("response" in parsed) return parsed.response;

  const result = await changeMemberRole(
    orgDeps(),
    auth.actor,
    userId,
    parsed.data.role,
  );
  return result.ok ? NextResponse.json({ status: "ok" }) : failureResponse(result.code);
}

export async function DELETE(request: Request, { params }: Params) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireActor();
  if ("response" in auth) return auth.response;
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) return failureResponse("not_found");

  const result = await removeMember(orgDeps(), auth.actor, userId);
  return result.ok ? NextResponse.json({ status: "ok" }) : failureResponse(result.code);
}
