import { NextResponse } from "next/server";
import { resetPasswordSchema } from "@mailory/validation";
import { apiError, assertSameOrigin, clientIp, limit, parseJson } from "@/lib/api";
import { authDeps } from "@/lib/auth/session";
import { resetPassword } from "@/lib/auth/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const limited = await limit(`reset:${clientIp(request)}`, 10, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, resetPasswordSchema);
  if ("response" in parsed) return parsed.response;
  const ok = await resetPassword(authDeps(), parsed.data.token, parsed.data.password);
  return ok
    ? NextResponse.json({ status: "ok" })
    : apiError(400, "invalid_token", "Bağlantı geçersiz veya süresi dolmuş.");
}
