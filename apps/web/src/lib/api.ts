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
  plan_limit: [402, "Planınızın sınırına ulaştınız."],
} as const;

export function failureResponse(code: keyof typeof FAILURE_STATUS) {
  const [status, message] = FAILURE_STATUS[code];
  return apiError(status, code, message);
}

const SERVICE_STATUS: Record<string, [number, string]> = {
  forbidden: [403, "Bu işlem için yetkiniz yok."],
  not_found: [404, "Kayıt bulunamadı."],
  duplicate: [409, "Bu kayıt zaten var."],
  suppressed: [409, "Bu adres bastırma listesinde."],
  invalid: [400, "Geçersiz istek."],
  too_large: [413, "Dosya çok büyük."],
  conflict: [409, "Kayıt başka biri tarafından değiştirildi."],
  ai_unavailable: [503, "Yapay zekâ yardımcısı bu ortamda yapılandırılmamış."],
  ai_disabled: [
    409,
    "Yapay zekâ yardımcısı bu çalışma alanı için kapalı. Bir yönetici açabilir.",
  ],
  limit_reached: [429, "Günlük yapay zekâ kullanım sınırına ulaşıldı."],
  ai_failed: [502, "Yapay zekâ şu anda yanıt veremedi. Lütfen tekrar deneyin."],
  plan_limit: [402, "Planınızın sınırına ulaştınız."],
  suspended: [403, "Bu çalışma alanı askıya alınmış."],
  not_ready: [422, "Kampanya henüz gönderime hazır değil."],
  approval_required: [409, "Bu kampanya onaya gönderilmelidir."],
  self_approval: [403, "Kendi gönderdiğiniz kampanyayı onaylayamazsınız."],
  free_mail: [400, "Ücretsiz e-posta sağlayıcıları gönderici olarak kullanılamaz."],
  platform_domain: [400, "Bu alan adı kullanılamaz."],
  provider_error: [
    502,
    "Sağlayıcıya şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.",
  ],
};

/** Maps a service `Failure` to an HTTP error, preferring the service's own user-facing message. */
export function serviceFailure(failure: { code: string; message?: string }) {
  const [status, fallback] = SERVICE_STATUS[failure.code] ?? [400, "Geçersiz istek."];
  return apiError(status, failure.code, failure.message ?? fallback);
}

type ActorContext = { actor: Actor; user: { id: string; email: string } };

/**
 * One wrapper for every tenant API route: CSRF (for writes) → authenticated actor with live role →
 * handler. The handler can only ever see the session-derived organization.
 */
export async function withActor(
  request: Request,
  options: { write: boolean },
  handler: (ctx: ActorContext) => Promise<Response>,
): Promise<Response> {
  if (options.write) {
    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;
  }
  const auth = await requireActor();
  if ("response" in auth) return auth.response;
  return handler({ actor: auth.actor, user: auth.user });
}

/** JSON body size guard (the import endpoints accept multi-MB CSV text). */
export function tooLarge(request: Request, maxBytes: number): NextResponse | null {
  const length = Number(request.headers.get("content-length") ?? 0);
  return length > maxBytes ? apiError(413, "too_large", "İstek çok büyük.") : null;
}
