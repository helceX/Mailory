import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATUSES,
  allowedTransitions,
  canTransition,
  evaluateReadiness,
  hasBlockers,
  isEditable,
  isTerminal,
  slugifyUtm,
  type ReadinessInput,
} from "./campaign";

const ok: ReadinessInput = {
  subject: "Merhaba",
  senderIdentity: { usable: true },
  hasTemplate: true,
  templateArchived: false,
  audience: { kind: "all" },
  audienceExists: true,
  audienceCount: 10,
  hasUnsubscribe: true,
  unknownMergeKeys: [],
  blockCount: 3,
};

describe("campaign state machine", () => {
  it("allows the intended path and nothing else", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("draft", "pending_approval")).toBe(true);
    expect(canTransition("pending_approval", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "sending")).toBe(true);
    expect(canTransition("sending", "completed")).toBe(true);
    // Skipping approval, resurrecting finished campaigns, and un-sending are impossible.
    expect(canTransition("draft", "sending")).toBe(false);
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("completed", "draft")).toBe(false);
    expect(canTransition("cancelled", "scheduled")).toBe(false);
    expect(canTransition("sending", "draft")).toBe(false);
  });
  it("terminal states have no exits; only drafts are editable", () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(isTerminal(s)).toBe(allowedTransitions(s).length === 0);
      expect(isEditable(s)).toBe(s === "draft");
    }
    expect(
      isTerminal("completed") && isTerminal("cancelled") && isTerminal("failed"),
    ).toBe(true);
  });
  it("never transitions to itself", () => {
    for (const s of CAMPAIGN_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe("evaluateReadiness", () => {
  it("passes a complete campaign", () => {
    expect(evaluateReadiness(ok)).toEqual([]);
  });
  it.each([
    [{ subject: "  " }, "no_subject"],
    [{ senderIdentity: null }, "no_sender"],
    [{ senderIdentity: { usable: false } }, "sender_unusable"],
    [{ hasTemplate: false }, "no_template"],
    [{ templateArchived: true }, "template_archived"],
    [{ audience: null }, "no_audience"],
    [{ audienceExists: false }, "audience_missing"],
    [{ audienceCount: 0 }, "audience_empty"],
    [{ hasUnsubscribe: false }, "no_unsubscribe"],
    [{ blockCount: 0 }, "empty_content"],
  ] as [Partial<ReadinessInput>, string][])("blocks on %j", (patch, code) => {
    const issues = evaluateReadiness({ ...ok, ...patch });
    expect(issues.find((i) => i.code === code)?.severity).toBe("blocker");
    expect(hasBlockers(issues)).toBe(true);
  });
  it("only warns for long subjects and unknown merge fields", () => {
    const issues = evaluateReadiness({
      ...ok,
      subject: "x".repeat(90),
      unknownMergeKeys: ["foo"],
    });
    expect(issues.map((i) => i.severity)).toEqual(["warning", "warning"]);
    expect(hasBlockers(issues)).toBe(false);
  });
});

describe("slugifyUtm", () => {
  it("makes analytics-safe values", () => {
    expect(slugifyUtm("Yaz Kampanyası 2026!")).toBe("yaz-kampanyasi-2026");
    expect(slugifyUtm("  ÇĞİÖŞÜ ")).toBe("cgiosu");
  });
});
