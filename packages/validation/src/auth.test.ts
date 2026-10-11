import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, resetPasswordSchema } from "./auth";

const ok = {
  email: "  Ada@Example.COM ",
  password: "a-long-enough-pass",
  firstName: "Ada",
  lastName: "L",
};

describe("auth schemas", () => {
  it("normalizes email to trimmed lowercase", () => {
    expect(registerSchema.parse(ok).email).toBe("ada@example.com");
  });
  it("rejects short and oversized passwords at registration", () => {
    expect(registerSchema.safeParse({ ...ok, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, password: "x".repeat(129) }).success).toBe(
      false,
    );
  });
  it("rejects invalid email and blank names", () => {
    expect(registerSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, firstName: "  " }).success).toBe(false);
  });
  it("login accepts any non-empty password (no policy leak)", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(
      true,
    );
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(
      false,
    );
  });
  it("reset requires a token and a policy-compliant password", () => {
    expect(
      resetPasswordSchema.safeParse({ token: "t".repeat(30), password: "short" })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        token: "t".repeat(30),
        password: "long-enough-pw!",
      }).success,
    ).toBe(true);
  });
});
