import { NextResponse } from "next/server";
import { addDomainSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { senderDeps } from "@/lib/senders/deps";
import { addDomain, listDomains } from "@/lib/senders/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await listDomains(senderDeps(), actor);
    if (!result.ok) return serviceFailure(result);
    // List view: status only. DNS tokens are shown on the detail page, to those who manage senders.
    return NextResponse.json({
      domains: result.domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        status: d.status,
        lastCheckedAt: d.lastCheckedAt,
        verifiedAt: d.verifiedAt,
      })),
    });
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const limited = await limit(`domain-add:${actor.organizationId}`, 20, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, addDomainSchema);
    if ("response" in parsed) return parsed.response;
    const result = await addDomain(senderDeps(), actor, parsed.data.domain);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
