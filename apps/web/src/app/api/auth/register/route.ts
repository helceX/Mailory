import { NextResponse } from "next/server";
import { registerSchema } from "@mailory/validation";
import { assertSameOrigin, clientIp, limit, parseJson } from "@/lib/api";
import { authDeps } from "@/lib/auth/session";
import { register } from "@/lib/auth/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const limited = await limit(`register:${clientIp(request)}`, 5, 3600);
  if (limited) return limited;
  const parsed = await parseJson(request, registerSchema);
  if ("response" in parsed) return parsed.response;

  await register(authDeps(), parsed.data);
  // Identical for new and existing addresses (no account enumeration).
  return NextResponse.json({ status: "check_email" }, { status: 202 });
}
