import { describe, expect, it } from "vitest";
import {
  inviteMemberSchema,
  updateMemberRoleSchema,
  createOrganizationSchema,
} from "./org";

describe("org schemas", () => {
  it("cannot invite as owner", () => {
    expect(
      inviteMemberSchema.safeParse({ email: "a@b.co", role: "owner" }).success,
    ).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ email: "A@B.co", role: "editor" }).data?.email,
    ).toBe("a@b.co");
  });
  it("rejects unknown roles", () => {
    expect(updateMemberRoleSchema.safeParse({ role: "superuser" }).success).toBe(false);
  });
  it("trims and bounds org name", () => {
    expect(createOrganizationSchema.safeParse({ name: " x " }).success).toBe(false);
    expect(createOrganizationSchema.parse({ name: "  Acme  " }).name).toBe("Acme");
  });
});
