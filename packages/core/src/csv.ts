/**
 * Minimal RFC 4180 CSV for imports/exports (no dependency). Handles BOM, CRLF/LF, quoted fields
 * with embedded delimiters/newlines/escaped quotes, and detects `,` vs `;` — Turkish Excel
 * exports semicolon-separated files by default.
 */
export type CsvParseResult = {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";" | "\t";
};

export function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]!++;
  }
  if (counts[";"]! > counts[","]! && counts[";"]! >= counts["\t"]!) return ";";
  if (counts["\t"]! > counts[","]!) return "\t";
  return ",";
}

export function parseCsv(input: string): CsvParseResult {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip fully blank lines (a single empty field).
    if (!(row.length === 1 && row[0] === "")) records.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();

  const [head, ...rows] = records;
  return { headers: (head ?? []).map((h) => h.trim()), rows, delimiter };
}

/** Spreadsheet apps execute cells starting with these as formulas (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvLine(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(",") + "\r\n";
}

/** UTF-8 BOM so Excel opens Turkish characters correctly. */
export const CSV_BOM = "\uFEFF";
