import { describe, expect, it } from "vitest";
import { checkDb } from "./index";

describe("checkDb", () => {
  it("returns true when the query succeeds", async () => {
    const pool = { query: async () => ({ rows: [] }) } as never;
    expect(await checkDb(pool)).toBe(true);
  });
  it("returns false when the query fails", async () => {
    const pool = {
      query: async () => {
        throw new Error("down");
      },
    } as never;
    expect(await checkDb(pool)).toBe(false);
  });
  it("returns false on timeout", async () => {
    const pool = { query: () => new Promise(() => {}) } as never;
    expect(await checkDb(pool, 20)).toBe(false);
  });
});
