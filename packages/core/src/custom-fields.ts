export type FieldDefinition = {
  key: string;
  label: string;
  type: string;
  options?: string[] | null;
};
export type CustomValue = string | number | boolean | null;

const TRUE_WORDS = new Set(["true", "1", "yes", "evet", "e", "y"]);
const FALSE_WORDS = new Set(["false", "0", "no", "hayır", "hayir", "h", "n"]);

/**
 * Coerces a raw value (from a form or CSV cell) to the field's declared type. Empty input clears
 * the value (null). Returns an error message rather than throwing — callers report it per row.
 */
export function coerceCustomValue(
  field: FieldDefinition,
  raw: unknown,
): { ok: true; value: CustomValue } | { ok: false; error: string } {
  if (
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "")
  )
    return { ok: true, value: null };
  const fail = (what: string) => ({
    ok: false as const,
    error: `"${field.label}" için geçerli bir ${what} girin.`,
  });

  switch (field.type) {
    case "text":
      return { ok: true, value: String(raw).trim().slice(0, 500) };
    case "number": {
      const n =
        typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
      return Number.isFinite(n) ? { ok: true, value: n } : fail("sayı");
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const word = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return { ok: true, value: true };
      if (FALSE_WORDS.has(word)) return { ok: true, value: false };
      return fail("evet/hayır değeri");
    }
    case "date": {
      const text = String(raw).trim();
      const parsed = Date.parse(text);
      if (Number.isNaN(parsed)) return fail("tarih");
      return { ok: true, value: new Date(parsed).toISOString().slice(0, 10) };
    }
    case "select": {
      const text = String(raw).trim();
      const match = (field.options ?? []).find(
        (o) => o.toLowerCase() === text.toLowerCase(),
      );
      return match
        ? { ok: true, value: match }
        : {
            ok: false,
            error: `"${field.label}" için izin verilen değerlerden biri seçilmeli.`,
          };
    }
    default:
      return { ok: false, error: `Bilinmeyen alan türü: ${field.type}` };
  }
}

/** Validates a whole custom-values object against the organization's field definitions. */
export function coerceCustomValues(
  fields: FieldDefinition[],
  input: Record<string, unknown>,
): { ok: true; value: Record<string, CustomValue> } | { ok: false; error: string } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, CustomValue> = {};
  for (const [key, raw] of Object.entries(input)) {
    const field = byKey.get(key);
    if (!field) return { ok: false, error: `Bilinmeyen özel alan: ${key}` };
    const result = coerceCustomValue(field, raw);
    if (!result.ok) return result;
    out[key] = result.value;
  }
  return { ok: true, value: out };
}
