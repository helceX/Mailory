import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignDraftSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import {
  deleteCampaignFor,
  getCampaignFor,
  updateCampaignFor,
} from "@/lib/campaigns/service";

type Params = { params: Promise<{ id: string }> };
const notFound = () => serviceFailure({ code: "not_found" });

export function GET(request: Request, { params }: Params) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await getCampaignFor(campaignDeps(), actor, id);
    if (!result.ok) return serviceFailure(result);
    const { ok: _ok, ...body } = result;
    return NextResponse.json(body);
  });
}

export function PATCH(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const parsed = await parseJson(request, campaignDraftSchema);
    if ("response" in parsed) return parsed.response;
    const result = await updateCampaignFor(campaignDeps(), actor, id, parsed.data);
    return result.ok ? NextResponse.json({ ok: true }) : serviceFailure(result);
  });
}

export function DELETE(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await deleteCampaignFor(campaignDeps(), actor, id);
    return result.ok ? NextResponse.json({ ok: true }) : serviceFailure(result);
  });
}
