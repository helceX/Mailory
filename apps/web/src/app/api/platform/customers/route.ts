import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withPlatformAdmin } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { createCustomerFor } from "@/lib/platform/service";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
});

export function POST(request: Request) {
  return withPlatformAdmin(request, { write: true }, async ({ admin }) => {
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const r = await createCustomerFor(orgDeps(), admin, parsed.data);
    return r.ok
      ? NextResponse.json({ id: r.id, invited: r.invited }, { status: 201 })
      : serviceFailure(r);
  });
}
