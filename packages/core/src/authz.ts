/**
 * RBAC (docs/MAILORY_DECISIONS.md D-008, D-027). Roles are string keys resolved against this
 * single table — never scattered switch statements — so custom roles later are a data addition.
 * `platform_admin` is a user flag, not an org role.
 */
export const ORG_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "org:manage_settings",
  "org:manage_members",
  "org:manage_billing",
  "org:delete",
  "audit_log:read",
  "contacts:read",
  "contacts:write",
  "contacts:export",
  "templates:read",
  "templates:write",
  "campaigns:read",
  "campaigns:write",
  "campaigns:send",
  "campaigns:approve",
  "analytics:read",
  "sender:manage",
  "brand:manage",
  "api_keys:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const viewer: readonly Permission[] = [
  "contacts:read",
  "templates:read",
  "campaigns:read",
  "analytics:read",
];
// Editors may send; the approval workflow (Phase 7) is an org-level policy that gates this, not a role.
const editor: readonly Permission[] = [
  ...viewer,
  "contacts:write",
  "contacts:export",
  "templates:write",
  "campaigns:write",
  "campaigns:send",
];
const admin: readonly Permission[] = [
  ...editor,
  "campaigns:approve",
  "org:manage_settings",
  "org:manage_members",
  "audit_log:read",
  "sender:manage",
  "brand:manage",
  "api_keys:manage",
];
const owner: readonly Permission[] = [...admin, "org:manage_billing", "org:delete"];

const rolePermissions: Record<OrgRole, readonly Permission[]> = {
  owner,
  admin,
  editor,
  viewer,
};

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function can(role: OrgRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function permissionsForRole(role: OrgRole): readonly Permission[] {
  return rolePermissions[role];
}

/**
 * Who may grant or change which roles. Owners manage everyone (including promoting owners);
 * anyone else may only act on, and assign, roles strictly below their own — no peer or upward
 * escalation. Requires `org:manage_members` in every case.
 */
export function canAssignRole(actor: OrgRole, role: OrgRole): boolean {
  if (!can(actor, "org:manage_members")) return false;
  return actor === "owner" || ROLE_RANK[role] < ROLE_RANK[actor];
}

export function canManageMember(actor: OrgRole, targetCurrentRole: OrgRole): boolean {
  if (!can(actor, "org:manage_members")) return false;
  return actor === "owner" || ROLE_RANK[targetCurrentRole] < ROLE_RANK[actor];
}
