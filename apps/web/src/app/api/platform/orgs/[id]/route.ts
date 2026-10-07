import { NextResponse } from "next/server";
import { z } from "zod";
import { ENTITLEMENT_KEYS, PLAN_KEYS } from "@mailory/core";
import { parseJson, serviceFailure, withPlatformAdmin } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import * as platform from "@/lib/platform/service";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("plan"),
    planKey: z.enum(PLAN_KEYS),
    note: z.string().max(300).nullish(),
  }),
  z.object({
    action: z.literal("limit"),
    key: z.enum(ENTITLEMENT_KEYS),
    limit: z.union([z.number().int().min(0), z.null(), z.literal("clear")]),
    reason: z.string().max(300).nullish(),
  }),
  z.object({
    action: z.literal("daily"),
    limit: z.number().int().min(0).max(10_000_000),
  }),
  z.object({ action: z.literal("suspend"), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("reinstate") }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("join") }),
]);

export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withPlatformAdmin(request, { write: true }, async ({ admin }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const b = parsed.data;
    const deps = orgDeps();
    const r =
      b.action === "plan"
        ? await platform.setPlanFor(deps, admin, id, {
            planKey: b.planKey,
            note: b.note ?? null,
          })
        : b.action === "limit"
          ? await platform.setLimitFor(deps, admin, id, {
              key: b.key,
              limit: b.limit,
              reason: b.reason ?? null,
            })
          : b.action === "daily"
            ? await platform.setDailyLimitFor(deps, admin, id, b.limit)
            : b.action === "suspend"
              ? await platform.suspendFor(deps, admin, id, b.reason)
              : b.action === "reinstate"
                ? await platform.suspendFor(deps, admin, id, null)
                : b.action === "restore"
                  ? await platform.restoreOrgFor(deps, admin, id)
                  : b.action === "join"
                    ? await platform.joinOrgFor(deps, admin, id)
                    : { ok: false as const, code: "invalid" };
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
