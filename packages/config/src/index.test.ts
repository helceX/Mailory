import { describe, expect, it } from "vitest";
import { parseEnv } from "./index";

const base = {
  SESSION_SECRET: "x".repeat(32),
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.EMAIL_PROVIDER).toBe("console");
    expect(env.DEFAULT_LOCALE).toBe("tr");
  });
  it("rejects a short session secret", () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short" })).toThrow(
      /SESSION_SECRET/,
    );
  });
  it("requires DATABASE_URL", () => {
    const rest: Record<string, string | undefined> = { ...base };
    delete rest.DATABASE_URL;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });
  it("requires AWS_REGION for ses", () => {
    expect(() => parseEnv({ ...base, EMAIL_PROVIDER: "ses" })).toThrow(/AWS_REGION/);
    expect(
      parseEnv({ ...base, EMAIL_PROVIDER: "ses", AWS_REGION: "eu-west-1" }).AWS_REGION,
    ).toBe("eu-west-1");
  });
});
