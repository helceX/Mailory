import { describe, expect, it } from "vitest";
import { classifyTaxId, isValidTckn, isValidVkn } from "./tax-id";

describe("isValidVkn", () => {
  it("accepts numbers with a correct check digit", () => {
    // Vectors computed with an independent implementation of the GİB scheme.
    expect(isValidVkn("1234567890")).toBe(true);
    expect(isValidVkn("0000000001")).toBe(true);
    expect(isValidVkn("1111111114")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidVkn("1234567891")).toBe(false);
    expect(isValidVkn("0000000008")).toBe(false);
  });

  it("rejects wrong length and non-digits", () => {
    expect(isValidVkn("123456789")).toBe(false);
    expect(isValidVkn("12345678901")).toBe(false);
    expect(isValidVkn("12345abcde")).toBe(false);
    expect(isValidVkn("")).toBe(false);
  });
});

describe("isValidTckn", () => {
  it("accepts a number with correct check digits", () => {
    expect(isValidTckn("10000000146")).toBe(true);
  });

  it("rejects a wrong 10th or 11th digit", () => {
    expect(isValidTckn("10000000147")).toBe(false);
    expect(isValidTckn("10000000156")).toBe(false);
  });

  it("rejects a leading zero, wrong length and non-digits", () => {
    expect(isValidTckn("00000000000")).toBe(false);
    expect(isValidTckn("1000000014")).toBe(false);
    expect(isValidTckn("1000000014a")).toBe(false);
  });
});

describe("classifyTaxId", () => {
  it("tells a company VKN from a person TCKN, and rejects garbage", () => {
    expect(classifyTaxId("1234567890")).toBe("vkn");
    expect(classifyTaxId("10000000146")).toBe("tckn");
    expect(classifyTaxId("1234567891")).toBeNull();
    expect(classifyTaxId("abc")).toBeNull();
  });
});
