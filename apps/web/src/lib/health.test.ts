import { describe, expect, it } from "vitest";
import { runChecks } from "./health";

describe("runChecks", () => {
  it("is ok when every check passes", async () => {
    const r = await runChecks({ db: async () => true, redis: async () => true });
    expect(r.ok).toBe(true);
  });
  it("fails when a check returns false or throws", async () => {
    const r = await runChecks({
      db: async () => false,
      redis: async () => {
        throw new Error("x");
      },
    });
    expect(r.ok).toBe(false);
    expect(r.checks.redis).toEqual({ ok: false });
  });
});
