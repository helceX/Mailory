import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "./email";

describe("email", () => {
  it("normalizes case and whitespace", () =>
    expect(normalizeEmail("  A@B.Co ")).toBe("a@b.co"));
  it("accepts ordinary addresses", () => {
    for (const e of ["a@b.co", "first.last+tag@sub.example.com.tr", "şule@example.com"])
      expect(isValidEmail(e)).toBe(true);
  });
  it("rejects malformed ones", () => {
    for (const e of [
      "",
      "a",
      "a@b",
      "a@@b.co",
      "a b@c.co",
      "a@b..co",
      "<a@b.co>",
      "a@b.c",
      `${"x".repeat(250)}@b.co`,
    ])
      expect(isValidEmail(e)).toBe(false);
  });
});
