import { sql, type SQL } from "drizzle-orm";
import { fieldType } from "@mailory/core";

/*
 * Compiles a validated segment AST (see @mailory/validation) to a parameterized SQL predicate over
 * `contacts`. Safety rules: column names come ONLY from the constant COLUMN table below; every
 * user-supplied value is a bound parameter; custom-field keys are bound parameters too (never
 * identifiers); LIKE patterns are escaped. Anything unknown throws rather than being passed through.
 */

type Rule = {
  type: "rule";
  field: string;
  op: string;
  value?: string | number | string[];
};
type Group = { type: "group"; op: "and" | "or"; not?: boolean; children: Node[] };
export type SegmentNodeInput = Rule | Group;
type Node = SegmentNodeInput;

const COLUMN: Record<string, SQL> = {
  email: sql.raw("contacts.email"),
  first_name: sql.raw("contacts.first_name"),
  last_name: sql.raw("contacts.last_name"),
  company: sql.raw("contacts.company"),
  position: sql.raw("contacts.position"),
  website: sql.raw("contacts.website"),
  phone: sql.raw("contacts.phone"),
  sector: sql.raw("contacts.sector"),
  city: sql.raw("contacts.city"),
  source: sql.raw("contacts.source"),
  status: sql.raw("contacts.status"),
  consent_status: sql.raw("contacts.consent_status"),
  engagement_score: sql.raw("contacts.engagement_score"),
  created_at: sql.raw("contacts.created_at"),
  last_activity_at: sql.raw("contacts.last_activity_at"),
};

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : [String(v)];

/**
 * SQL is three-valued: `NOT (company = 'x')` is NULL — not true — for contacts with no company, so
 * they would silently vanish from a "NOT" segment. Every rule is therefore collapsed to true/false
 * (unknown = false) so AND / OR / NOT behave the way people reason about them.
 */
function compileRule(rule: Rule, organizationId: string): SQL {
  return sql`coalesce(${compileRuleRaw(rule, organizationId)}, false)`;
}

function compileRuleRaw(rule: Rule, organizationId: string): SQL {
  const type = fieldType(rule.field);
  if (!type) throw new Error(`Unknown segment field: ${rule.field}`);

  if (type === "list" || type === "tag") {
    const [table, idColumn] =
      type === "list" ? ["list_contacts", "list_id"] : ["contact_tags", "tag_id"];
    const ids = sql.join(
      asList(rule.value).map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // The org predicate inside the subquery means a foreign id can never match another tenant's data.
    const exists = sql`exists (select 1 from ${sql.raw(table!)} x where x.contact_id = contacts.id and x.organization_id = ${organizationId}::uuid and x.${sql.raw(idColumn!)} in (${ids}))`;
    return rule.op === "not_in" ? sql`not ${exists}` : exists;
  }

  // Resolve the left-hand expression.
  let column: SQL;
  let numeric = type === "number";
  if (type === "custom") {
    const key = rule.field.slice("custom.".length);
    const text = sql`(contacts.custom ->> ${key})`;
    if (["gt", "gte", "lt", "lte"].includes(rule.op)) {
      column = sql`(case when ${text} ~ '^-?[0-9]+(\\.[0-9]+)?$' then ${text}::numeric end)`;
      numeric = true;
    } else column = text;
  } else {
    const known = COLUMN[rule.field];
    if (!known) throw new Error(`Unknown segment field: ${rule.field}`);
    column = known;
  }

  const v = rule.value;
  switch (rule.op) {
    case "is_empty":
      return type === "custom" || type === "text"
        ? sql`(${column} is null or ${column} = '')`
        : sql`${column} is null`;
    case "is_not_empty":
      return type === "custom" || type === "text"
        ? sql`(${column} is not null and ${column} <> '')`
        : sql`${column} is not null`;
    case "eq":
      return numeric
        ? sql`${column} = ${Number(v)}`
        : sql`lower(${column}) = lower(${String(v)})`;
    case "neq":
      // `is distinct from` so rows with NULL are included in "not equal", as users expect.
      return numeric
        ? sql`${column} is distinct from ${Number(v)}`
        : sql`lower(${column}) is distinct from lower(${String(v)})`;
    case "in":
      return sql`${column} in (${sql.join(
        asList(v).map((x) => sql`${x}`),
        sql`, `,
      )})`;
    case "contains":
      return sql`${column} ilike ${"%" + escapeLike(String(v)) + "%"} escape '\\'`;
    case "not_contains":
      return sql`(${column} is null or ${column} not ilike ${"%" + escapeLike(String(v)) + "%"} escape '\\')`;
    case "starts_with":
      return sql`${column} ilike ${escapeLike(String(v)) + "%"} escape '\\'`;
    case "gt":
      return sql`${column} > ${Number(v)}`;
    case "gte":
      return sql`${column} >= ${Number(v)}`;
    case "lt":
      return sql`${column} < ${Number(v)}`;
    case "lte":
      return sql`${column} <= ${Number(v)}`;
    case "before":
      return sql`${column} < ${new Date(String(v))}`;
    case "after":
      return sql`${column} > ${new Date(String(v))}`;
    case "in_last_days":
      return sql`${column} >= now() - make_interval(days => ${Math.floor(Number(v))})`;
    default:
      throw new Error(`Unsupported operator: ${rule.op}`);
  }
}

export function compileSegment(node: SegmentNodeInput, organizationId: string): SQL {
  if (node.type === "rule") return compileRule(node, organizationId);
  const parts = node.children.map((child) => compileSegment(child, organizationId));
  const joined = sql`(${sql.join(parts, node.op === "and" ? sql` and ` : sql` or `)})`;
  return node.not ? sql`not ${joined}` : joined;
}
