import { enforce } from "../billing/enforce";
import {
  can,
  canAssignRole,
  canManageMember,
  generateToken,
  hashToken,
  slugify,
  type OrgRole,
  type Permission,
} from "@mailory/core";
import {
  acceptInvitation as acceptInvitationRow,
  createInvitation,
  createOrganizationWithOwner,
  findInvitationByTokenHash,
  getMember,
  getOrganization,
  listAuditLogs,
  listMembers,
  listPendingInvitations,
  recordAudit,
  removeMember as removeMemberRow,
  revokeInvitation as revokeInvitationRow,
  updateMemberRole as updateMemberRoleRow,
  type Database,
  type OrganizationId,
} from "@mailory/db";
import type { SendEmail } from "../auth/service";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OrgDeps = {
  db: Database;
  sendEmail: SendEmail;
  appUrl: string;
  now?: () => Date;
};

/**
 * Who is acting, resolved server-side from the session + live membership — never from client input.
 * Every service function re-checks authorization itself, so routes, workers and the future public
 * API all share one enforcement point (defense in depth, not just a route guard).
 */
export type Actor = {
  userId: string;
  organizationId: OrganizationId;
  role: OrgRole;
  ip?: string | null;
  userAgent?: string | null;
};

export type Failure = {
  ok: false;
  code:
    | "forbidden"
    | "not_found"
    | "last_owner"
    | "already_member"
    | "invalid"
    | "email_mismatch"
    | "plan_limit";
  message?: string;
};
export type Success<T = object> = { ok: true } & T;

const now = (deps: OrgDeps) => (deps.now ?? (() => new Date()))();
const forbidden: Failure = { ok: false, code: "forbidden" };

function audit(
  deps: OrgDeps,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}

export function authorize(actor: Actor, permission: Permission): boolean {
  return can(actor.role, permission);
}

export async function createOrganization(
  deps: OrgDeps,
  userId: string,
  name: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const org = await createOrganizationWithOwner(deps.db, {
    name,
    slug: slugify(name),
    userId,
  });
  await recordAudit(deps.db, {
    organizationId: org.id as OrganizationId,
    userId,
    action: "org.created",
    entityType: "organization",
    entityId: org.id,
    ...meta,
  });
  return org;
}

export async function getOrganizationFor(deps: OrgDeps, actor: Actor) {
  return getOrganization(deps.db, actor.organizationId);
}

// Any member may see who else is in their organization; managing them needs org:manage_members.
export async function listOrgMembers(deps: OrgDeps, actor: Actor) {
  return listMembers(deps.db, actor.organizationId);
}

export async function listOrgInvitations(deps: OrgDeps, actor: Actor) {
  if (!authorize(actor, "org:manage_members")) return forbidden;
  return {
    ok: true as const,
    invitations: await listPendingInvitations(deps.db, actor.organizationId, now(deps)),
  };
}

export async function listOrgAudit(
  deps: OrgDeps,
  actor: Actor,
  options: { limit?: number; before?: Date } = {},
) {
  if (!authorize(actor, "audit_log:read")) return forbidden;
  return {
    ok: true as const,
    entries: await listAuditLogs(deps.db, actor.organizationId, options),
  };
}

export async function inviteMember(
  deps: OrgDeps,
  actor: Actor,
  input: { email: string; role: Exclude<OrgRole, "owner"> },
): Promise<Success<{ invitationId: string }> | Failure> {
  if (!canAssignRole(actor.role, input.role)) return forbidden;

  const members = await listMembers(deps.db, actor.organizationId);
  if (members.some((m) => m.email.toLowerCase() === input.email.toLowerCase()))
    return { ok: false, code: "already_member" };

  const org = await getOrganization(deps.db, actor.organizationId);
  if (!org) return { ok: false, code: "not_found" };
  const limited = await enforce(deps.db, actor.organizationId, "members", 1, now(deps));
  if (limited) return limited;

  const token = generateToken();
  const invitation = await createInvitation(deps.db, actor.organizationId, {
    email: input.email,
    role: input.role,
    tokenHash: hashToken(token),
    invitedByUserId: actor.userId,
    expiresAt: new Date(now(deps).getTime() + INVITATION_TTL_MS),
  });
  await audit(deps, actor, "member.invited", "invitation", invitation.id, {
    role: input.role,
  });

  try {
    await deps.sendEmail({
      to: input.email,
      kind: "invitation",
      subject: `${org.name} sizi Mailory'ye davet etti`,
      text: `${org.name} organizasyonuna "${input.role}" rolüyle davet edildiniz.\n\nKatılmak için (7 gün geçerli):\n${deps.appUrl}/accept-invite?token=${token}\n\nDavetle aynı e-posta adresiyle giriş yapmanız (gerekirse kayıt olmanız) gerekir.`,
    });
  } catch (error) {
    // The invitation exists and can be re-sent; do not fail the whole action on transport errors.
    console.error("[org] invitation email failed", error);
  }
  return { ok: true, invitationId: invitation.id };
}

export async function revokeInvitation(
  deps: OrgDeps,
  actor: Actor,
  invitationId: string,
): Promise<Success | Failure> {
  if (!authorize(actor, "org:manage_members")) return forbidden;
  const revoked = await revokeInvitationRow(
    deps.db,
    actor.organizationId,
    invitationId,
  );
  if (!revoked) return { ok: false, code: "not_found" };
  await audit(deps, actor, "invitation.revoked", "invitation", invitationId);
  return { ok: true };
}

/** The signed-in, email-verified user must own the invited address. */
export async function acceptInvitation(
  deps: OrgDeps,
  user: { id: string; email: string },
  token: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<Success<{ organizationId: OrganizationId; role: OrgRole }> | Failure> {
  const found = await findInvitationByTokenHash(deps.db, hashToken(token));
  if (!found) return { ok: false, code: "not_found" };
  if (found.invitation.email.toLowerCase() !== user.email.toLowerCase())
    return { ok: false, code: "email_mismatch" };

  const accepted = await acceptInvitationRow(deps.db, {
    invitationId: found.invitation.id,
    userId: user.id,
    now: now(deps),
  });
  if (!accepted) return { ok: false, code: "not_found" }; // used, revoked or expired
  if (accepted.alreadyMember) return { ok: false, code: "already_member" };

  await recordAudit(deps.db, {
    organizationId: accepted.organizationId,
    userId: user.id,
    action: "invitation.accepted",
    entityType: "invitation",
    entityId: found.invitation.id,
    metadata: { role: accepted.role },
    ...meta,
  });
  return { ok: true, organizationId: accepted.organizationId, role: accepted.role };
}

export async function changeMemberRole(
  deps: OrgDeps,
  actor: Actor,
  targetUserId: string,
  role: OrgRole,
): Promise<Success | Failure> {
  // Look the target up inside the actor's own org: a user id from another tenant simply isn't found.
  const target = await getMember(deps.db, actor.organizationId, targetUserId);
  if (!target) return { ok: false, code: "not_found" };
  if (!canManageMember(actor.role, target.role) || !canAssignRole(actor.role, role))
    return forbidden;

  const result = await updateMemberRoleRow(
    deps.db,
    actor.organizationId,
    targetUserId,
    role,
  );
  if (result !== "ok") return { ok: false, code: result };
  await audit(deps, actor, "member.role_changed", "membership", targetUserId, {
    from: target.role,
    to: role,
  });
  return { ok: true };
}

/** Members may always leave; removing someone else needs authority over their role. */
export async function removeMember(
  deps: OrgDeps,
  actor: Actor,
  targetUserId: string,
): Promise<Success | Failure> {
  const target = await getMember(deps.db, actor.organizationId, targetUserId);
  if (!target) return { ok: false, code: "not_found" };
  const leaving = targetUserId === actor.userId;
  if (!leaving && !canManageMember(actor.role, target.role)) return forbidden;

  const result = await removeMemberRow(deps.db, actor.organizationId, targetUserId);
  if (result !== "ok") return { ok: false, code: result };
  await audit(
    deps,
    actor,
    leaving ? "member.left" : "member.removed",
    "membership",
    targetUserId,
    { role: target.role },
  );
  return { ok: true };
}
