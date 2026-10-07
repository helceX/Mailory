import { NextResponse } from "next/server";
import { inviteMemberSchema } from "@mailory/validation";
import {
  assertSameOrigin,
  failureResponse,
  limit,
  parseJson,
  requireActor,
} from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { inviteMember } from "@/lib/org/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireActor();
  if ("response" in auth) return auth.response;
  const limited = await limit(`invite:${auth.actor.organizationId}`, 30, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, inviteMemberSchema);
  if ("response" in parsed) return parsed.response;

  const result = await inviteMember(orgDeps(), auth.actor, parsed.data);
  return result.ok
    ? NextResponse.json({ invitationId: result.invitationId }, { status: 201 })
    : failureResponse(result.code);
}
