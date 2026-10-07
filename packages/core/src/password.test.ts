import { describe, expect, it } from "vitest";
import {
  burnPasswordCheck,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";

const fast = { N: 2 ** 10, r: 8, p: 1 };

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery", fast);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("salts: same password hashes differently", async () => {
    expect(await hashPassword("same", fast)).not.toBe(await hashPassword("same", fast));
  });
  it("treats NFKC-equivalent passwords as equal", async () => {
    const hash = await hashPassword("ｐａｓｓｗｏｒｄ１２３", fast);
    expect(await verifyPassword("password123", hash)).toBe(true);
  });
  it("fails closed on malformed or corrupt hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "scrypt$3$8$1$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$x$8$1$aa$bb")).toBe(false);
  });
  it("flags hashes weaker than current defaults", async () => {
    expect(needsRehash(await hashPassword("x", fast))).toBe(true);
  });
  it("burnPasswordCheck resolves without throwing", async () => {
    await expect(burnPasswordCheck("anything")).resolves.toBeUndefined();
  });
});
