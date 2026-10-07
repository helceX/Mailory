import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { senderDeps } from "@/lib/senders/deps";
import { getDomainDetail, removeDomain } from "@/lib/senders/service";

type Params = { params: Promise<{ id: string }> };
const notFound = () => serviceFailure({ code: "not_found" });

export function GET(request: Request, { params }: Params) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await getDomainDetail(senderDeps(), actor, id);
    if (!result.ok) return serviceFailure(result);
    const { domain, records } = result;
    return NextResponse.json({
      domain: {
        id: domain.id,
        domain: domain.domain,
        status: domain.status,
        lastCheckedAt: domain.lastCheckedAt,
        verifiedAt: domain.verifiedAt,
        lastError: domain.lastError,
        failingSince: domain.failingSince,
        lastCheck: domain.lastCheck,
      },
      records,
    });
  });
}

export function DELETE(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await removeDomain(senderDeps(), actor, id);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
