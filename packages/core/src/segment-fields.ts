/**
 * The single registry of fields a segment (or contact filter) may reference. The compiler maps
 * these keys to columns through a constant table — user input is never interpolated as an identifier.
 */
export type FieldType = "text" | "enum" | "number" | "date" | "list" | "tag";

export const SEGMENT_FIELDS = [
  { key: "email", label: "E-posta", type: "text" },
  { key: "first_name", label: "Ad", type: "text" },
  { key: "last_name", label: "Soyad", type: "text" },
  { key: "company", label: "Şirket", type: "text" },
  { key: "position", label: "Pozisyon", type: "text" },
  { key: "website", label: "Web sitesi", type: "text" },
  { key: "phone", label: "Telefon", type: "text" },
  { key: "sector", label: "Sektör", type: "text" },
  { key: "city", label: "Şehir", type: "text" },
  { key: "source", label: "Kaynak", type: "text" },
  {
    key: "status",
    label: "Durum",
    type: "enum",
    options: ["subscribed", "unsubscribed", "bounced", "complained", "cleaned"],
  },
  {
    key: "consent_status",
    label: "İzin durumu",
    type: "enum",
    options: ["granted", "unknown", "withdrawn"],
  },
  { key: "engagement_score", label: "Etkileşim skoru", type: "number" },
  { key: "created_at", label: "Eklenme tarihi", type: "date" },
  { key: "last_activity_at", label: "Son aktivite", type: "date" },
  { key: "list", label: "Liste", type: "list" },
  { key: "tag", label: "Etiket", type: "tag" },
] as const;

export type SegmentFieldKey = (typeof SEGMENT_FIELDS)[number]["key"];

export const OPERATORS_BY_TYPE: Record<FieldType | "custom", readonly string[]> = {
  text: [
    "eq",
    "neq",
    "contains",
    "not_contains",
    "starts_with",
    "is_empty",
    "is_not_empty",
  ],
  enum: ["eq", "neq", "in"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  date: ["before", "after", "in_last_days", "is_empty", "is_not_empty"],
  list: ["in", "not_in"],
  tag: ["in", "not_in"],
  custom: [
    "eq",
    "neq",
    "contains",
    "not_contains",
    "starts_with",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_empty",
    "is_not_empty",
  ],
};

export const CUSTOM_FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const RESERVED_FIELD_KEYS: readonly string[] = SEGMENT_FIELDS.map((f) => f.key);

export function fieldType(key: string): FieldType | "custom" | null {
  const standard = SEGMENT_FIELDS.find((f) => f.key === key);
  if (standard) return standard.type;
  if (key.startsWith("custom.") && CUSTOM_FIELD_KEY_RE.test(key.slice(7)))
    return "custom";
  return null;
}
