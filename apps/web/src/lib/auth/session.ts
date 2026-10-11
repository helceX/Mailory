import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getEnv } from "@mailory/config";
import { getDb } from "../db";
import { sendSystemEmail } from "../email";
import { resolveSession, type AuthDeps } from "./service";

// `__Host-` pins the cookie to this exact host over HTTPS (no Domain, Path=/); it needs Secure,
// so it is only used in production.
export function sessionCookieName() {
  return getEnv().NODE_ENV === "production"
    ? "__Host-mailory_session"
    : "mailory_session";
}

export function authDeps(): AuthDeps {
  return { db: getDb().db, sendEmail: sendSystemEmail, appUrl: getEnv().APP_URL };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(sessionCookieName());
}

export async function readSessionCookie() {
  return (await cookies()).get(sessionCookieName())?.value ?? null;
}

/** Current user for server components; null when signed out. Memoized per request. */
export const getCurrentUser = cache(async () => {
  const token = await readSessionCookie();
  if (!token) return null;
  const resolved = await resolveSession(authDeps(), token);
  return resolved?.user ?? null;
});
