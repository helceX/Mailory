import { describe, expect, it } from "vitest";
import {
  clickToken,
  openToken,
  readClickToken,
  readOpenToken,
  readViewToken,
  viewToken,
  readUnsubscribeToken,
  signToken,
  unsubscribeToken,
  verifyToken,
} from "./signed-token";

const S = "s".repeat(40);
const ORG = "11111111-1111-1111-1111-111111111111";
const REC = "22222222-2222-2222-2222-222222222222";

describe("signed tokens", () => {
  it("round-trips an unsubscribe token", () => {
    expect(readUnsubscribeToken(S, unsubscribeToken(S, ORG, REC))).toEqual({
      organizationId: ORG,
      recipientId: REC,
    });
  });
  it("rejects a different secret, tampering and truncation", () => {
    const t = unsubscribeToken(S, ORG, REC);
    expect(readUnsubscribeToken("x".repeat(40), t)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify([ORG, "33333333-3333-3333-3333-333333333333"]),
    ).toString("base64url");
    expect(readUnsubscribeToken(S, `${forged}.${sig}`)).toBeNull();
    expect(readUnsubscribeToken(S, `${body}.${sig!.slice(0, -2)}`)).toBeNull();
    expect(readUnsubscribeToken(S, `${t}.x`)).toBeNull();
    expect(readUnsubscribeToken(S, "")).toBeNull();
    expect(readUnsubscribeToken(S, "a".repeat(600))).toBeNull();
  });
  it("is bound to its purpose", () => {
    const other = signToken(S, "something-else", [ORG, REC]);
    expect(readUnsubscribeToken(S, other)).toBeNull();
    expect(verifyToken(S, "something-else", other)).toEqual([ORG, REC]);
  });
});

describe("tracking and view tokens", () => {
  const C = "33333333-3333-3333-3333-333333333333";
  const L = "44444444-4444-4444-4444-444444444444";
  it("round-trip with the right shape", () => {
    expect(readClickToken(S, clickToken(S, ORG, C, REC, L))).toEqual({
      organizationId: ORG,
      campaignId: C,
      recipientId: REC,
      linkId: L,
    });
    expect(readOpenToken(S, openToken(S, ORG, C, REC))).toEqual({
      organizationId: ORG,
      campaignId: C,
      recipientId: REC,
    });
    expect(readViewToken(S, viewToken(S, ORG, REC))).toEqual({
      organizationId: ORG,
      recipientId: REC,
    });
  });
  it("a token for one purpose never works for another (an open pixel cannot unsubscribe or redirect)", () => {
    const open = openToken(S, ORG, C, REC);
    expect(readClickToken(S, open)).toBeNull();
    expect(readUnsubscribeToken(S, open)).toBeNull();
    expect(readViewToken(S, open)).toBeNull();
    expect(readOpenToken(S, unsubscribeToken(S, ORG, REC))).toBeNull();
    expect(readViewToken(S, unsubscribeToken(S, ORG, REC))).toBeNull();
  });
});
