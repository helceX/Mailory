import { NextResponse } from "next/server";
import { brandKitSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { getBrandKit, saveBrandKit } from "@/lib/templates/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getBrandKit(templateDeps(), actor);
    return result.ok
      ? NextResponse.json({ brand: result.brand, configured: result.configured })
      : serviceFailure(result);
  });
}

export function PUT(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, brandKitSchema);
    if ("response" in parsed) return parsed.response;
    const result = await saveBrandKit(templateDeps(), actor, parsed.data);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
