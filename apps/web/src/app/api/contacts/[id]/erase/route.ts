import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { getDb } from "@/lib/db";
import { eraseContactFor } from "@/lib/privacy/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await eraseContactFor({ db: getDb().db }, actor, id);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
