import { NextResponse } from "next/server";
import { serviceFailure, withActor } from "@/lib/api";
import { aiDeps } from "@/lib/ai/deps";
import { getAiStatus } from "@/lib/ai/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await getAiStatus(aiDeps(), actor);
    if (!r.ok) return serviceFailure(r);
    const { ok: _ok, ...body } = r;
    return NextResponse.json(body);
  });
}
