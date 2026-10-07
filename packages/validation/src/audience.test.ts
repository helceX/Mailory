import { describe, expect, it } from "vitest";
import {
  bulkActionSchema,
  contactInputSchema,
  customFieldSchema,
  importRunSchema,
} from "./audience";

describe("audience schemas", () => {
  it("normalizes email and blanks to null", () => {
    const c = contactInputSchema.parse({ email: " Ada@EXAMPLE.com ", company: "  " });
    expect(c.email).toBe("ada@example.com");
    expect(c.company).toBeNull();
  });
  it("rejects invalid email", () =>
    expect(contactInputSchema.safeParse({ email: "nope" }).success).toBe(false));
  it("rejects custom keys with bad shapes", () => {
    expect(
      contactInputSchema.safeParse({ email: "a@b.co", custom: { "Bad Key": "x" } })
        .success,
    ).toBe(false);
    expect(
      contactInputSchema.safeParse({ email: "a@b.co", custom: { ok_key: "x" } })
        .success,
    ).toBe(true);
  });
  it("custom field keys cannot shadow system fields", () => {
    expect(
      customFieldSchema.safeParse({ key: "email", label: "E", type: "text" }).success,
    ).toBe(false);
    expect(
      customFieldSchema.safeParse({
        key: "funding_round",
        label: "Tur",
        type: "select",
        options: ["Seed"],
      }).success,
    ).toBe(true);
  });
  it("bulk actions need a target and cap explicit ids", () => {
    expect(bulkActionSchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(bulkActionSchema.safeParse({ action: "delete", ids: [] }).success).toBe(
      false,
    );
    expect(
      bulkActionSchema.safeParse({ action: "delete", filter: { status: "bounced" } })
        .success,
    ).toBe(true);
    expect(
      bulkActionSchema.safeParse({
        action: "set_status",
        ids: ["123e4567-e89b-42d3-a456-426614174000"],
        status: "cleaned",
      }).success,
    ).toBe(true);
  });
  it("import requires the consent attestation", () => {
    const base = { csv: "email\na@b.co", mapping: { email: "email" } };
    expect(importRunSchema.safeParse(base).success).toBe(false);
    expect(importRunSchema.safeParse({ ...base, consentAttested: false }).success).toBe(
      false,
    );
    expect(importRunSchema.safeParse({ ...base, consentAttested: true }).success).toBe(
      true,
    );
  });
});
