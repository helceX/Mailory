import { NextResponse } from "next/server";
import { forgotPasswordSchema } from "@mailory/validation";
import { assertSameOrigin, clientIp, limit, parseJson } from "@/lib/api";
import { authDeps } from "@/lib/auth/session";
import { requestPasswordReset } from "@/lib/auth/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const limited = await limit(`forgot-ip:${clientIp(request)}`, 5, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, forgotPasswordSchema);
  if ("response" in parsed) return parsed.response;
  const perAccount = await limit(`forgot-email:${parsed.data.email}`, 3, 3600);
  if (perAccount) return perAccount;

  await requestPasswordReset(authDeps(), parsed.data.email);
  return NextResponse.json({ status: "check_email" }, { status: 202 });
}
