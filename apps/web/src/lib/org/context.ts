import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { clientIpFrom, type OrgRole } from "@mailory/core";
import {
  asOrganizationId,
  listUserMemberships,
  setActiveOrganization,
} from "@mailory/db";
import { authDeps, readSessionCookie } from "../auth/session";
import { resolveSession } from "../auth/service";
import type { Actor, OrgDeps } from "./service";

export function orgDeps(): OrgDeps {
  return authDeps();
}

/**
 * The single place a request's tenant is decided: session → live membership check → active org.
 * The active org stored on the session is a hint only; it is re-validated against the user's
 * memberships on every request, and an invalid or stale one falls back to the first membership.
 */
export const getOrgContext = cache(async () => {
  const token = await readSessionCookie();
  if (!token) return null;
  const deps = orgDeps();
  const session = await resolveSession(deps, token);
  if (!session) return null;

  const memberships = await listUserMemberships(deps.db, session.user.id);
  const active =
    memberships.find((m) => m.organizationId === session.activeOrganizationId) ??
    memberships[0];
  if (active && active.organizationId !== session.activeOrganizationId) {
    await setActiveOrganization(deps.db, {
      sessionId: session.sessionId,
      userId: session.user.id,
      organizationId: active.organizationId,
    });
  }

  const requestHeaders = await headers();
  const actor: Actor | null = active
    ? {
        userId: session.user.id,
        organizationId: asOrganizationId(active.organizationId),
        role: active.role as OrgRole,
        ip: clientIpFrom(requestHeaders.get("x-forwarded-for")),
        userAgent: requestHeaders.get("user-agent")?.slice(0, 300) ?? null,
      }
    : null;

  return {
    sessionId: session.sessionId,
    user: session.user,
    memberships,
    organization: active ?? null,
    actor,
  };
});
