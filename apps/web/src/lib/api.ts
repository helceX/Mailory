import "server-only";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { clientIpFrom, isSameOrigin } from "@mailory/core";
import { getEnv } from "@mailory/config";
import { checkRateLimit } from "./rate-limit";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message, requestId: crypto.randomUUID() } },
    { status },
  );
}

/** CSRF: mutating requests must come from our own origin. */
export function assertSameOrigin(request: Request): NextResponse | null {
  const url = new URL(request.url);
  const ok = isSameOrigin({
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    nextOrigin: url.origin,
    appUrl: getEnv().APP_URL,
  });
  return ok ? null : apiError(403, "forbidden_origin", "İstek reddedildi.");
}

export function clientIp(request: Request) {
  return clientIpFrom(request.headers.get("x-forwarded-for"));
}

export async function limit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const { allowed } = await checkRateLimit(key, max, windowSeconds);
  return allowed
    ? null
    : apiError(
        429,
        "rate_limited",
        "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.",
      );
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: apiError(400, "invalid_json", "Geçersiz istek gövdesi.") };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Geçersiz giriş.";
    return { response: apiError(400, "validation_error", message) };
  }
  return { data: result.data };
}

import { getOrgContext } from "./org/context";
import type { Actor } from "./org/service";

/** Resolves the acting user + their live role in the active org, or the right error response. */
export async function requireActor(): Promise<
  | { actor: Actor; sessionId: string; user: { id: string; email: string } }
  | { response: NextResponse }
> {
  const context = await getOrgContext();
  if (!context)
    return { response: apiError(401, "unauthenticated", "Oturum açmanız gerekiyor.") };
  if (!context.actor)
    return {
      response: apiError(409, "no_organization", "Önce bir organizasyon oluşturun."),
    };
  return { actor: context.actor, sessionId: context.sessionId, user: context.user };
}

const FAILURE_STATUS = {
  forbidden: [403, "Bu işlem için yetkiniz yok."],
  not_found: [404, "Kayıt bulunamadı."],
  last_owner: [409, "Organizasyonun en az bir sahibi olmalı."],
  already_member: [409, "Bu kişi zaten organizasyonun üyesi."],
  invalid: [400, "Geçersiz istek."],
  email_mismatch: [403, "Bu davet farklı bir e-posta adresi için gönderilmiş."],
} as const;

export function failureResponse(code: keyof typeof FAILURE_STATUS) {
  const [status, message] = FAILURE_STATUS[code];
  return apiError(status, code, message);
}
