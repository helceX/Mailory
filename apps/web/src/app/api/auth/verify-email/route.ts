import { NextResponse } from "next/server";
import { verifyEmailSchema } from "@mailory/validation";
import { apiError, assertSameOrigin, clientIp, limit, parseJson } from "@/lib/api";
import { authDeps } from "@/lib/auth/session";
import { verifyEmail } from "@/lib/auth/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const limited = await limit(`verify:${clientIp(request)}`, 20, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, verifyEmailSchema);
  if ("response" in parsed) return parsed.response;
  const ok = await verifyEmail(authDeps(), parsed.data.token);
  return ok
    ? NextResponse.json({ status: "verified" })
    : apiError(400, "invalid_token", "Bağlantı geçersiz veya süresi dolmuş.");
}
