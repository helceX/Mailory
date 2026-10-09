import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api";
import { authDeps, clearSessionCookie, readSessionCookie } from "@/lib/auth/session";
import { logout } from "@/lib/auth/service";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const token = await readSessionCookie();
  if (token) await logout(authDeps(), token);
  await clearSessionCookie();
  return NextResponse.json({ status: "ok" });
}
