import { NextResponse } from "next/server";
import { createOrganizationSchema } from "@mailory/validation";
import { setActiveOrganization, asOrganizationId } from "@mailory/db";
import { apiError, assertSameOrigin, clientIp, limit, parseJson } from "@/lib/api";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { createOrganization } from "@/lib/org/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const context = await getOrgContext();
  if (!context) return apiError(401, "unauthenticated", "Oturum açmanız gerekiyor.");
  const limited = await limit(`org-create:${context.user.id}`, 5, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, createOrganizationSchema);
  if ("response" in parsed) return parsed.response;

  const deps = orgDeps();
  const org = await createOrganization(deps, context.user.id, parsed.data.name, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  await setActiveOrganization(deps.db, {
    sessionId: context.sessionId,
    userId: context.user.id,
    organizationId: asOrganizationId(org.id),
  });
  return NextResponse.json({ organizationId: org.id, slug: org.slug }, { status: 201 });
}
