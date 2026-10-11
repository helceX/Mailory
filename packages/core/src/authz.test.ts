import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  canManageMember,
  can,
  ORG_ROLES,
  PERMISSIONS,
  permissionsForRole,
} from "./authz";

describe("role permissions", () => {
  it("roles are strictly nested: each role's permissions include the one below", () => {
    for (let i = 1; i < ORG_ROLES.length; i++) {
      const lower = new Set(permissionsForRole(ORG_ROLES[ORG_ROLES.length - i]!));
      const higher = new Set(permissionsForRole(ORG_ROLES[ORG_ROLES.length - i - 1]!));
      for (const p of lower) expect(higher.has(p)).toBe(true);
    }
  });
  it("owner holds every permission", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });
  it("viewer is read-only", () => {
    for (const p of permissionsForRole("viewer"))
      expect(p.endsWith(":read")).toBe(true);
  });
  it("only owner manages billing and deletes the org", () => {
    for (const role of ["admin", "editor", "viewer"] as const) {
      expect(can(role, "org:manage_billing")).toBe(false);
      expect(can(role, "org:delete")).toBe(false);
    }
  });
  it("only admin+ manage members, approve campaigns and read the audit log", () => {
    for (const p of [
      "org:manage_members",
      "campaigns:approve",
      "audit_log:read",
    ] as const) {
      expect(can("admin", p)).toBe(true);
      expect(can("editor", p)).toBe(false);
      expect(can("viewer", p)).toBe(false);
    }
  });
});

describe("role assignment hierarchy", () => {
  it("owner may assign any role", () => {
    for (const r of ORG_ROLES) expect(canAssignRole("owner", r)).toBe(true);
  });
  it("admin may assign only roles below admin", () => {
    expect(canAssignRole("admin", "editor")).toBe(true);
    expect(canAssignRole("admin", "viewer")).toBe(true);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "owner")).toBe(false);
  });
  it("editor and viewer may not assign anything", () => {
    for (const r of ORG_ROLES) {
      expect(canAssignRole("editor", r)).toBe(false);
      expect(canAssignRole("viewer", r)).toBe(false);
    }
  });
  it("admin cannot manage peers or owners", () => {
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(false);
    expect(canManageMember("admin", "editor")).toBe(true);
    expect(canManageMember("owner", "owner")).toBe(true);
  });
});
