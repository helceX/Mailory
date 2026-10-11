import { NextResponse } from "next/server";
import { loginSchema } from "@mailory/validation";
import { apiError, assertSameOrigin, clientIp, limit, parseJson } from "@/lib/api";
import { authDeps, setSessionCookie } from "@/lib/auth/session";
import { login } from "@/lib/auth/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const ip = clientIp(request);
  const limited = await limit(`login-ip:${ip}`, 20, 900);
  if (limited) return limited;
  const parsed = await parseJson(request, loginSchema);
  if ("response" in parsed) return parsed.response;
  const perAccount = await limit(`login-email:${parsed.data.email}`, 8, 900);
  if (perAccount) return perAccount;

  const result = await login(authDeps(), parsed.data, {
    ipAddress: ip,
    userAgent: request.headers.get("user-agent")?.slice(0, 300),
  });
  if (!result.ok) {
    if (result.reason === "email_not_verified")
      return apiError(
        403,
        "email_not_verified",
        "E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzu kontrol edin.",
      );
    if (result.reason === "disabled")
      return apiError(403, "account_disabled", "Hesabınız devre dışı bırakılmış.");
    return apiError(401, "invalid_credentials", "E-posta veya parola hatalı.");
  }
  await setSessionCookie(result.sessionToken, result.expiresAt);
  return NextResponse.json({ status: "ok" });
}
