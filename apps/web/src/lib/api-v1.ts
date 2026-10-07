import "server-only";
import { NextResponse } from "next/server";
import {
  apiHashesEqual,
  apiScopeAllows,
  bearerFrom,
  clientIpFrom,
  limitMessage,
  parseApiKey,
  type ApiKeyScope,
} from "@mailory/core";
import {
  bumpApiUsage,
  checkEntitlement,
  findApiKeyByPrefix,
  touchApiKey,
  asOrganizationId,
} from "@mailory/db";
import { apiError, limit } from "./api";
import { getDb } from "./db";
import type { Actor } from "./org/service";

/** Requests per minute per API key. */
export const API_RATE_PER_MINUTE = 300;

type Ctx = { actor: Actor; keyId: string };

const unauthorized = () =>
  apiError(401, "invalid_api_key", "Geçersiz veya iptal edilmiş API anahtarı.");

/**
 * Wrapper for every public `/api/v1` route. Authentication is the bearer API key (no cookies, hence no CSRF check — a
 * browser never attaches it on its own). The key fixes the organization and a role derived from its scope, so the
 * ordinary service layer (RBAC, plan limits, tenant scoping) is reused unchanged. Order: failed-auth throttle → key →
 * scope → per-key rate limit → plan quota → handler.
 */
export async function withApiKey(
  request: Request,
  needs: ApiKeyScope,
  handler: (ctx: Ctx) => Promise<Response>,
): Promise<Response> {
  const ip = clientIpFrom(request.headers.get("x-forwarded-for")) ?? "unknown";
  const raw = bearerFrom(
    request.headers.get("authorization"),
    request.headers.get("x-api-key"),
  );
  const parsed = raw ? parseApiKey(raw) : null;
  const { db } = getDb();
  const key = parsed ? await findApiKeyByPrefix(db, parsed.prefix) : null;
  const valid =
    key && parsed && !key.revokedAt && apiHashesEqual(key.secretHash, parsed.hash);
  if (!valid || !key.createdByUserId) {
    // Count only failures, so guessing is throttled while legitimate traffic is untouched.
    const blocked = await limit(`apifail:${ip}`, 30, 60);
    return blocked ?? unauthorized();
  }
  if (key.suspendedAt)
    return apiError(403, "suspended", "Bu çalışma alanı askıya alınmış.");
  if (!apiScopeAllows(key.scope as ApiKeyScope, needs))
    return apiError(
      403,
      "insufficient_scope",
      "Bu anahtar yazma yetkisine sahip değil.",
    );

  const throttled = await limit(`api:${key.id}`, API_RATE_PER_MINUTE, 60);
  if (throttled) return throttled;

  const org = asOrganizationId(key.organizationId);
  const now = new Date();
  const quota = await checkEntitlement(db, org, "api_requests", 1, now);
  if (!quota.allowed) return apiError(402, "plan_limit", limitMessage(quota));
  await bumpApiUsage(db, org, now);
  await touchApiKey(db, org, key.id, now);

  const response = await handler({
    keyId: key.id,
    actor: {
      userId: key.createdByUserId,
      organizationId: org,
      role: key.scope === "write" ? "editor" : "viewer",
      ip: ip === "unknown" ? null : ip,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const apiJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });
