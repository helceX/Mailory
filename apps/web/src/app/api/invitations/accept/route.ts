import { NextResponse } from "next/server";
import { acceptInvitationSchema } from "@mailory/validation";
import { setActiveOrganization } from "@mailory/db";
import {
  apiError,
  assertSameOrigin,
  clientIp,
  failureResponse,
  limit,
  parseJson,
} from "@/lib/api";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { acceptInvitation } from "@/lib/org/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const context = await getOrgContext();
  if (!context)
    return apiError(
      401,
      "unauthenticated",
      "Davetı kabul etmek için önce giriş yapın.",
    );
  const limited = await limit(`accept-invite:${clientIp(request)}`, 20, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, acceptInvitationSchema);
  if ("response" in parsed) return parsed.response;

  const deps = orgDeps();
  const result = await acceptInvitation(deps, context.user, parsed.data.token, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) return failureResponse(result.code);
  await setActiveOrganization(deps.db, {
    sessionId: context.sessionId,
    userId: context.user.id,
    organizationId: result.organizationId,
  });
  return NextResponse.json({ status: "ok" });
}
