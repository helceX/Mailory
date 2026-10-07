import { NextResponse } from "next/server";
import { serviceFailure, withActor } from "@/lib/api";
import { orgDeps } from "@/lib/org/context";
import { listHubForChild } from "@/lib/partner/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await listHubForChild(orgDeps(), actor);
    return r.ok
      ? NextResponse.json({
          sponsorName: r.sponsorName,
          templates: r.templates.map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            description: t.description,
          })),
        })
      : serviceFailure(r);
  });
}
