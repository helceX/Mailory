import { describe, expect, it } from "vitest";
import { segmentDefinitionSchema } from "./segment";

const ok = (v: unknown) => segmentDefinitionSchema.safeParse(v).success;
const rule = (field: string, op: string, value?: unknown) => ({
  type: "rule",
  field,
  op,
  ...(value === undefined ? {} : { value }),
});
const and = (...children: unknown[]) => ({ type: "group", op: "and", children });
const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("segment validation", () => {
  it("accepts the brief's example: company = Startup AND sector = Technology AND score > 70", () => {
    expect(
      ok(
        and(
          rule("company", "eq", "Startup"),
          rule("sector", "eq", "Technology"),
          rule("engagement_score", "gt", 70),
        ),
      ),
    ).toBe(true);
  });
  it("supports OR, NOT and nesting", () => {
    expect(
      ok({
        type: "group",
        op: "or",
        not: true,
        children: [
          rule("city", "eq", "Ankara"),
          and(rule("status", "eq", "subscribed"), rule("tag", "in", [UUID])),
        ],
      }),
    ).toBe(true);
  });
  it("rejects unknown fields (no arbitrary column access)", () => {
    expect(ok(and(rule("password_hash", "eq", "x")))).toBe(false);
    expect(ok(and(rule("email; drop table contacts", "eq", "x")))).toBe(false);
    expect(ok(and(rule("custom.Bad-Key", "eq", "x")))).toBe(false);
  });
  it("accepts well-formed custom fields", () => {
    expect(ok(and(rule("custom.industry_size", "gt", 10)))).toBe(true);
  });
  it("rejects operators that do not fit the field type", () => {
    expect(ok(and(rule("status", "contains", "sub")))).toBe(false);
    expect(ok(and(rule("engagement_score", "contains", "7")))).toBe(false);
    expect(ok(and(rule("list", "eq", UUID)))).toBe(false);
  });
  it("validates values: enums, numbers, dates, uuids", () => {
    expect(ok(and(rule("status", "eq", "weird")))).toBe(false);
    expect(ok(and(rule("engagement_score", "gt", "abc")))).toBe(false);
    expect(ok(and(rule("created_at", "after", "not-a-date")))).toBe(false);
    expect(ok(and(rule("created_at", "in_last_days", 30)))).toBe(true);
    expect(ok(and(rule("tag", "in", ["not-a-uuid"])))).toBe(false);
  });
  it("requires a value unless the operator is is_empty / is_not_empty", () => {
    expect(ok(and(rule("company", "eq")))).toBe(false);
    expect(ok(and(rule("company", "is_empty")))).toBe(true);
  });
  it("limits depth and size", () => {
    let node: unknown = rule("city", "eq", "x");
    for (let i = 0; i < 6; i++) node = and(node);
    expect(ok(node)).toBe(false);
    expect(ok(and(...Array.from({ length: 41 }, () => rule("city", "eq", "x"))))).toBe(
      false,
    );
    expect(ok({ type: "group", op: "and", children: [] })).toBe(false);
  });
});
