import { describe, expect, it } from "vitest";
import {
  generateApiKey,
  parseApiKey,
  apiScopeAllows,
  bearerFrom,
  apiHashesEqual,
} from "./api-keys";
import { isPrivateAddress, webhookBackoffSeconds, webhookUrlProblem } from "./webhook";
import { signWebhook, verifyWebhookSignature } from "./webhook-sign";

describe("api keys", () => {
  it("round-trips and never stores the secret", () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^mlk_[0-9a-f]{8}_/);
    const parsed = parseApiKey(k.key);
    expect(parsed?.prefix).toBe(k.prefix);
    expect(apiHashesEqual(parsed!.hash, k.hash)).toBe(true);
    expect(k.hash).not.toContain(k.key.split("_")[2]);
  });
  it("rejects malformed keys and wrong secrets", () => {
    expect(parseApiKey("nope")).toBeNull();
    expect(parseApiKey("mlk_zzzzzzzz_" + "a".repeat(43))).toBeNull();
    const k = generateApiKey();
    const other = parseApiKey(`mlk_${k.prefix}_${"a".repeat(43)}`)!;
    expect(apiHashesEqual(other.hash, k.hash)).toBe(false);
  });
  it("scopes: write implies read, read does not imply write", () => {
    expect(apiScopeAllows("write", "read")).toBe(true);
    expect(apiScopeAllows("read", "write")).toBe(false);
    expect(apiScopeAllows("read", "read")).toBe(true);
  });
  it("extracts bearer or x-api-key", () => {
    expect(bearerFrom("Bearer abc", null)).toBe("abc");
    expect(bearerFrom(null, "xyz")).toBe("xyz");
    expect(bearerFrom("Basic abc", null)).toBeNull();
  });
});

describe("webhook signing", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  it("verifies, and rejects tampering, wrong secret and replays", () => {
    const sig = signWebhook("sec", '{"a":1}', at);
    expect(verifyWebhookSignature("sec", '{"a":1}', sig, { now: at })).toBe(true);
    expect(verifyWebhookSignature("sec", '{"a":2}', sig, { now: at })).toBe(false);
    expect(verifyWebhookSignature("other", '{"a":1}', sig, { now: at })).toBe(false);
    expect(
      verifyWebhookSignature("sec", '{"a":1}', sig, {
        now: new Date(at.getTime() + 10 * 60_000),
      }),
    ).toBe(false);
    expect(verifyWebhookSignature("sec", "x", "garbage", { now: at })).toBe(false);
  });
});

describe("webhook url safety", () => {
  it.each([
    "http://example.com/h",
    "ftp://example.com",
    "not a url",
    "https://user:pw@example.com/",
    "https://localhost/h",
    "https://127.0.0.1/h",
    "https://10.1.2.3/h",
    "https://169.254.169.254/latest",
    "https://[::1]/h",
    "https://192.168.1.1/",
    "https://172.20.0.1/",
    "https://intranet/h",
    "https://svc.internal/h",
    "https://100.64.0.1/",
    "https://[::ffff:127.0.0.1]/",
    "https://[fd00::1]/",
  ])("rejects %s", (u) => expect(webhookUrlProblem(u)).not.toBeNull());
  it.each([
    "https://example.com/hooks/mailory",
    "https://hooks.zapier.com/x?y=1",
    "https://8.8.8.8/h",
  ])("accepts %s", (u) => expect(webhookUrlProblem(u)).toBeNull());
  it("allows plain http only when explicitly permitted (dev)", () => {
    expect(
      webhookUrlProblem("http://localhost:4000/h", { allowInsecure: true }),
    ).toBeNull();
  });
  it("even in dev mode only this machine is exempt, other internal targets stay blocked", () => {
    expect(
      webhookUrlProblem("http://10.0.0.5/h", { allowInsecure: true }),
    ).not.toBeNull();
    expect(
      webhookUrlProblem("https://169.254.169.254/", { allowInsecure: true }),
    ).not.toBeNull();
  });
  it("classifies addresses", () => {
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
  it("backoff ends", () => {
    expect(webhookBackoffSeconds(1)).toBe(30);
    expect(webhookBackoffSeconds(8)).toBeNull();
  });
});
