import { NextResponse } from "next/server";
import { switchOrganizationSchema } from "@mailory/validation";
import { asOrganizationId, setActiveOrganization } from "@mailory/db";
import { apiError, assertSameOrigin, failureResponse, parseJson } from "@/lib/api";
import { getOrgContext, orgDeps } from "@/lib/org/context";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const context = await getOrgContext();
  if (!context) return apiError(401, "unauthenticated", "Oturum açmanız gerekiyor.");
  const parsed = await parseJson(request, switchOrganizationSchema);
  if ("response" in parsed) return parsed.response;

  // Membership is verified inside; a foreign org id looks exactly like a nonexistent one.
  const ok = await setActiveOrganization(orgDeps().db, {
    sessionId: context.sessionId,
    userId: context.user.id,
    organizationId: asOrganizationId(parsed.data.organizationId),
  });
  return ok ? NextResponse.json({ status: "ok" }) : failureResponse("not_found");
}
