import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

describe("CSP", () => {
  const prod = buildCsp("NONCE", { dev: false, appUrl: "https://app.mailory.io" });
  it("allows scripts only via the nonce, never unsafe-inline/eval in production", () => {
    const script = prod.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-NONCE'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });
  it("locks down framing, forms, base URI, plugins and cross-origin connections", () => {
    for (const d of [
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "connect-src 'self'",
      "default-src 'self'",
    ])
      expect(prod).toContain(d);
    expect(prod).toContain("upgrade-insecure-requests");
  });
  it("dev adds eval and websockets for hot reload only", () => {
    const dev = buildCsp("N", { dev: true, appUrl: "http://localhost:3000" });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
  it("nonces are unique and unguessable-looking", () => {
    const set = new Set(Array.from({ length: 100 }, newNonce));
    expect(set.size).toBe(100);
    expect([...set][0]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
