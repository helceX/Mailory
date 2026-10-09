import { NextResponse } from "next/server";
import { senderIdentitySchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { senderDeps } from "@/lib/senders/deps";
import { createIdentity, listIdentities } from "@/lib/senders/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await listIdentities(senderDeps(), actor);
    return result.ok
      ? NextResponse.json({ identities: result.identities })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, senderIdentitySchema);
    if ("response" in parsed) return parsed.response;
    const result = await createIdentity(senderDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
