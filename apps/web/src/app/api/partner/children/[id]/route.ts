import { NextResponse } from "next/server";
import { z } from "zod";
import { ENTITLEMENT_KEYS, PLAN_KEYS } from "@mailory/core";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import * as partner from "@/lib/partner/service";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), planKey: z.enum(PLAN_KEYS) }),
  z.object({
    action: z.literal("limit"),
    key: z.enum(ENTITLEMENT_KEYS),
    limit: z.union([z.number().int().min(0), z.literal("clear")]),
    reason: z.string().max(300).nullish(),
  }),
  z.object({ action: z.literal("suspend"), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("reinstate") }),
  z.object({ action: z.literal("end_sponsorship") }),
]);

export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const b = parsed.data;
    const deps = orgDeps();
    const r =
      b.action === "plan"
        ? await partner.setChildPlanFor(deps, actor, id, b.planKey)
        : b.action === "limit"
          ? await partner.setChildLimitFor(deps, actor, id, {
              key: b.key,
              limit: b.limit,
              reason: b.reason ?? null,
            })
          : b.action === "suspend"
            ? await partner.suspendChildFor(deps, actor, id, b.reason)
            : b.action === "reinstate"
              ? await partner.suspendChildFor(deps, actor, id, null)
              : await partner.endSponsorshipFor(deps, actor, id);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
