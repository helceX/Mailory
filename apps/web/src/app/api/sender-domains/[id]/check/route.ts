import { NextResponse } from "next/server";
import { z } from "zod";
import { limit, serviceFailure, withActor } from "@/lib/api";
import { senderDeps } from "@/lib/senders/deps";
import { checkDomainNow } from "@/lib/senders/service";

// POST: it performs lookups and writes the result. Rate-limited so it cannot be used to hammer DNS.
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`domain-check:${actor.organizationId}`, 60, 3600);
    if (limited) return limited;
    const result = await checkDomainNow(senderDeps(), actor, id);
    if (!result.ok) return serviceFailure(result);
    const { status, becameVerified, claimedElsewhere, outcome } = result.result;
    return NextResponse.json({
      status,
      becameVerified,
      claimedElsewhere,
      inconclusive: outcome.inconclusive,
      results: outcome.results,
    });
  });
}
