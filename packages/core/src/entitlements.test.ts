import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_KEYS,
  ENTITLEMENT_LABELS,
  decide,
  limitMessage,
  monthStart,
} from "./entitlements";

describe("decide", () => {
  it("allows up to the limit and refuses beyond it", () => {
    expect(decide("contacts", 100, 99, 1)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(decide("contacts", 100, 100, 1)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(decide("contacts", 100, 90, 11).allowed).toBe(false);
    expect(decide("contacts", 100, 90, 10).allowed).toBe(true);
  });
  it("unlimited (null) always passes and reports no remaining cap", () => {
    expect(decide("contacts", null, 10_000_000, 5_000)).toMatchObject({
      allowed: true,
      remaining: null,
    });
  });
  it("freeing capacity (delta ≤ 0) is never blocked, even when already over the limit (downgrade)", () => {
    expect(decide("members", 2, 5, -1).allowed).toBe(true);
    expect(decide("members", 2, 5, 0).allowed).toBe(true);
    expect(decide("members", 2, 5, 1)).toMatchObject({ allowed: false, remaining: 0 });
  });
  it("a zero limit denies everything", () => {
    expect(decide("api_requests", 0, 0, 1).allowed).toBe(false);
  });
});

describe("messages and periods", () => {
  it("every key has a label and a period", () => {
    for (const k of ENTITLEMENT_KEYS) expect(ENTITLEMENT_LABELS[k].label).toBeTruthy();
  });
  it("limitMessage explains the situation in Turkish and is empty for unlimited", () => {
    expect(limitMessage(decide("contacts", 500, 500))).toContain("500 / 500");
    expect(limitMessage(decide("contacts", null, 5))).toBe("");
  });
  it("monthStart is the first UTC instant of the month", () => {
    expect(monthStart(new Date("2026-03-31T23:59:59Z")).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});
