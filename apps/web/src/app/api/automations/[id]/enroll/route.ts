import { NextResponse } from "next/server";
import { z } from "zod";
import { enrollSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { automationDeps } from "@/lib/automations/deps";
import { enrollAudienceFor } from "@/lib/automations/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`automation-enroll:${actor.organizationId}`, 30, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, enrollSchema);
    if ("response" in parsed) return parsed.response;
    const r = await enrollAudienceFor(
      automationDeps(),
      actor,
      id,
      parsed.data.audience,
    );
    return r.ok ? NextResponse.json({ enrolled: r.enrolled }) : serviceFailure(r);
  });
}
