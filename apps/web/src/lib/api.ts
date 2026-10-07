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
