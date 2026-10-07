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
  it("requires region, configuration set and SNS topic for ses", () => {
    const ses = { ...base, EMAIL_PROVIDER: "ses" };
    expect(() => parseEnv(ses)).toThrow(/AWS_REGION/);
    expect(() => parseEnv({ ...ses, AWS_REGION: "eu-west-1" })).toThrow(
      /SES_CONFIGURATION_SET/,
    );
    expect(() =>
      parseEnv({ ...ses, AWS_REGION: "eu-west-1", SES_CONFIGURATION_SET: "cs" }),
    ).toThrow(/SES_SNS_TOPIC_ARN/);
    expect(
      parseEnv({
        ...ses,
        AWS_REGION: "eu-west-1",
        SES_CONFIGURATION_SET: "cs",
        SES_SNS_TOPIC_ARN: "arn:aws:sns:eu-west-1:1:t",
      }).SEND_RATE_PER_SECOND,
    ).toBe(14);
  });
  it("defaults to the system DNS resolver and the mock domain provider", () => {
    const env = parseEnv(base);
    expect([env.DNS_RESOLVER, env.DOMAIN_PROVIDER]).toEqual(["system", "mock"]);
  });
  it("refuses the mock DNS resolver in production (it would let anyone 'publish' DNS)", () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: "production", DNS_RESOLVER: "mock" }),
    ).toThrow(/DNS_RESOLVER/);
    expect(
      parseEnv({ ...base, NODE_ENV: "development", DNS_RESOLVER: "mock" }).DNS_RESOLVER,
    ).toBe("mock");
    expect(parseEnv({ ...base, NODE_ENV: "production" }).DNS_RESOLVER).toBe("system");
  });
  it("AI is off by default; mock is refused in production; anthropic needs a key", () => {
    expect(parseEnv(base).AI_PROVIDER).toBe("none");
    expect(() =>
      parseEnv({ ...base, NODE_ENV: "production", AI_PROVIDER: "mock" }),
    ).toThrow(/AI_PROVIDER/);
    expect(() => parseEnv({ ...base, AI_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(
      parseEnv({ ...base, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })
        .AI_DAILY_LIMIT_PER_ORG,
    ).toBe(50);
  });
});
