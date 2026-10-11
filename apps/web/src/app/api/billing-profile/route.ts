import { NextResponse } from "next/server";
import { billingProfileSchema } from "@mailory/validation";
import { apiError, parseJson, serviceFailure, withActor } from "@/lib/api";
import { getBillingProfileFor, saveBillingProfileFor } from "@/lib/billing/profile";
import { getDb } from "@/lib/db";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const r = await getBillingProfileFor({ db: getDb().db }, actor);
    return r.ok ? NextResponse.json({ profile: r.profile }) : serviceFailure(r);
  });
}

export function PUT(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, billingProfileSchema);
    if ("response" in parsed) return parsed.response;
    const r = await saveBillingProfileFor({ db: getDb().db }, actor, parsed.data);
    return r.ok
      ? NextResponse.json({ ok: true })
      : r.code === "forbidden"
        ? serviceFailure(r)
        : apiError(400, "validation_error", "Geçersiz giriş.");
  });
}
