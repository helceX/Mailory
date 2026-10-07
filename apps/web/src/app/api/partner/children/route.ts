import { NextResponse } from "next/server";
import { z } from "zod";
import { PLAN_KEYS } from "@mailory/core";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { createEntrepreneurFor, listChildrenFor } from "@/lib/partner/service";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
  planKey: z.enum(PLAN_KEYS).optional(),
});

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await listChildrenFor(orgDeps(), actor);
    return r.ok ? NextResponse.json({ children: r.children }) : serviceFailure(r);
  });
}
export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const r = await createEntrepreneurFor(orgDeps(), actor, parsed.data);
    return r.ok
      ? NextResponse.json({ id: r.id, invited: r.invited }, { status: 201 })
      : serviceFailure(r);
  });
}
