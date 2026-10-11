import { z } from "zod";
import { fieldType, OPERATORS_BY_TYPE, SEGMENT_FIELDS } from "@mailory/core";

/**
 * Segment definition AST: groups (AND/OR, optionally negated) of rules. Plain data — it is validated
 * here and compiled to parameterized SQL in @mailory/db; raw SQL is never accepted.
 */
export type SegmentRule = {
  type: "rule";
  field: string;
  op: string;
  value?: string | number | string[];
};
export type SegmentGroup = {
  type: "group";
  op: "and" | "or";
  not?: boolean;
  children: SegmentNode[];
};
export type SegmentNode = SegmentRule | SegmentGroup;
export type SegmentDefinition = SegmentNode;

export const MAX_SEGMENT_DEPTH = 4;
export const MAX_SEGMENT_NODES = 40;

const valueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.array(z.string().max(100)).max(100),
]);

const ruleSchema = z.object({
  type: z.literal("rule"),
  field: z.string().max(60),
  op: z.string().max(30),
  value: valueSchema.optional(),
});

const nodeSchema: z.ZodType<SegmentNode> = z.lazy(() =>
  z.union([
    ruleSchema,
    z.object({
      type: z.literal("group"),
      op: z.enum(["and", "or"]),
      not: z.boolean().optional(),
      children: z.array(nodeSchema).min(1).max(MAX_SEGMENT_NODES),
    }),
  ]),
);

const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkRule(rule: SegmentRule): string | null {
  const type = fieldType(rule.field);
  if (!type) return `Bilinmeyen alan: ${rule.field}`;
  if (!OPERATORS_BY_TYPE[type].includes(rule.op))
    return `"${rule.field}" alanı için "${rule.op}" işlemi geçersiz.`;
  if (NO_VALUE_OPS.has(rule.op)) return null;
  const v = rule.value;
  if (v === undefined || v === "") return `"${rule.field}" için değer gerekli.`;

  if (type === "list" || type === "tag") {
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => UUID.test(x)))
      return `"${rule.field}" için geçerli kimlik listesi gerekli.`;
    return null;
  }
  if (type === "enum") {
    const options = (
      SEGMENT_FIELDS.find((f) => f.key === rule.field) as { options: readonly string[] }
    ).options;
    const values = Array.isArray(v) ? v : [String(v)];
    return values.every((x) => options.includes(x))
      ? null
      : `"${rule.field}" için geçersiz değer.`;
  }
  if (Array.isArray(v)) return `"${rule.field}" için tek bir değer gerekli.`;
  if (type === "number" || rule.op === "in_last_days") {
    return Number.isFinite(Number(v))
      ? null
      : `"${rule.field}" için sayısal değer gerekli.`;
  }
  if (type === "date")
    return Number.isNaN(Date.parse(String(v)))
      ? `"${rule.field}" için geçerli tarih gerekli.`
      : null;
  if (type === "custom" && ["gt", "gte", "lt", "lte"].includes(rule.op)) {
    return Number.isFinite(Number(v))
      ? null
      : `"${rule.field}" için sayısal değer gerekli.`;
  }
  return null;
}

function walk(node: SegmentNode, depth: number, counter: { n: number }): string | null {
  counter.n++;
  if (counter.n > MAX_SEGMENT_NODES) return "Segment çok karmaşık.";
  if (node.type === "rule") return checkRule(node);
  if (depth >= MAX_SEGMENT_DEPTH) return "Segment çok derin iç içe.";
  for (const child of node.children) {
    const problem = walk(child, depth + 1, counter);
    if (problem) return problem;
  }
  return null;
}

export const segmentDefinitionSchema = nodeSchema.superRefine((node, ctx) => {
  const problem = walk(node, 1, { n: 0 });
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

export const createSegmentSchema = z.object({
  name: z.string().trim().min(1, "Segment adı gerekli.").max(80),
  definition: segmentDefinitionSchema,
});
export const previewSegmentSchema = z.object({ definition: segmentDefinitionSchema });
