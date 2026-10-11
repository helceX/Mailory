import { describe, expect, it } from "vitest";
import { evaluateImpact, type ImpactGroup } from "./impact";
const group = (n: number, converted: number): ImpactGroup => ({
  assigned: n,
  converted,
  sent: n,
  contaminated: 0,
  erased: 0,
});
describe("impact evidence", () => {
  it("never turns empty or tiny samples into a winner", () => {
    expect(evaluateImpact(group(0, 0), group(0, 0), true, true)).toMatchObject({
      status: "insufficient",
      difference: 0,
      lower: -1,
      upper: 1,
    });
    expect(evaluateImpact(group(10, 10), group(10, 0), true, true).status).toBe(
      "insufficient",
    );
  });
  it("reports positive, negative and uncertain signals only after the window closes", () => {
    expect(evaluateImpact(group(1000, 200), group(1000, 50), false, true).status).toBe(
      "collecting",
    );
    expect(evaluateImpact(group(1000, 200), group(1000, 50), true, true).status).toBe(
      "positive",
    );
    expect(evaluateImpact(group(1000, 50), group(1000, 200), true, true).status).toBe(
      "negative",
    );
    expect(evaluateImpact(group(1000, 50), group(1000, 50), true, true).status).toBe(
      "inconclusive",
    );
  });
  it("refuses a directional recommendation for overlaps, erasure or incomplete delivery", () => {
    for (const patch of [{ contaminated: 1 }, { erased: 1 }])
      expect(
        evaluateImpact({ ...group(1000, 200), ...patch }, group(1000, 50), true, true)
          .status,
      ).toBe("compromised");
    expect(evaluateImpact(group(1000, 200), group(1000, 50), true, false).status).toBe(
      "compromised",
    );
  });
});
