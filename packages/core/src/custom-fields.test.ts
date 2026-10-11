import { describe, expect, it } from "vitest";
import {
  coerceCustomValue,
  coerceCustomValues,
  type FieldDefinition,
} from "./custom-fields";

const f = (type: string, options?: string[]): FieldDefinition => ({
  key: "k",
  label: "Alan",
  type,
  options,
});

describe("coerceCustomValue", () => {
  it("clears on empty input", () => {
    for (const raw of ["", "  ", null, undefined])
      expect(coerceCustomValue(f("number"), raw)).toEqual({ ok: true, value: null });
  });
  it("parses numbers including Turkish decimal commas", () => {
    expect(coerceCustomValue(f("number"), "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(coerceCustomValue(f("number"), "abc").ok).toBe(false);
    expect(coerceCustomValue(f("number"), "Infinity").ok).toBe(false);
  });
  it("parses booleans in English and Turkish", () => {
    expect(coerceCustomValue(f("boolean"), "Evet")).toEqual({ ok: true, value: true });
    expect(coerceCustomValue(f("boolean"), "hayır")).toEqual({
      ok: true,
      value: false,
    });
    expect(coerceCustomValue(f("boolean"), "belki").ok).toBe(false);
  });
  it("normalizes dates to YYYY-MM-DD and rejects garbage", () => {
    expect(coerceCustomValue(f("date"), "2026-03-05T10:00:00Z")).toEqual({
      ok: true,
      value: "2026-03-05",
    });
    expect(coerceCustomValue(f("date"), "dün").ok).toBe(false);
  });
  it("select must match an option (case-insensitive, canonicalized)", () => {
    expect(coerceCustomValue(f("select", ["Seed", "Series A"]), "series a")).toEqual({
      ok: true,
      value: "Series A",
    });
    expect(coerceCustomValue(f("select", ["Seed"]), "Series B").ok).toBe(false);
  });
  it("caps text length", () => {
    const r = coerceCustomValue(f("text"), "x".repeat(900));
    expect(r.ok && typeof r.value === "string" && r.value.length).toBe(500);
  });
});

describe("coerceCustomValues", () => {
  const fields = [{ key: "stage", label: "Aşama", type: "select", options: ["Seed"] }];
  it("rejects keys that are not defined for the organization", () => {
    expect(coerceCustomValues(fields, { evil: "x" })).toMatchObject({ ok: false });
  });
  it("accepts defined keys", () => {
    expect(coerceCustomValues(fields, { stage: "seed" })).toEqual({
      ok: true,
      value: { stage: "Seed" },
    });
  });
});
