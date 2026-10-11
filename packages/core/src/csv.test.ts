import { describe, expect, it } from "vitest";
import { CSV_BOM, detectDelimiter, escapeCsvCell, parseCsv, toCsvLine } from "./csv";

describe("parseCsv", () => {
  it("parses headers and rows, ignoring BOM and blank lines", () => {
    const r = parseCsv("﻿email,name\r\na@x.co,Ada\r\n\r\nb@x.co,Bob\r\n");
    expect(r.headers).toEqual(["email", "name"]);
    expect(r.rows).toEqual([
      ["a@x.co", "Ada"],
      ["b@x.co", "Bob"],
    ]);
  });
  it("handles quoted delimiters, newlines and escaped quotes", () => {
    const r = parseCsv('email,note\na@x.co,"hello, ""world""\nsecond line"\n');
    expect(r.rows).toEqual([["a@x.co", 'hello, "world"\nsecond line']]);
  });
  it("detects semicolon-separated Turkish Excel exports", () => {
    expect(detectDelimiter("e-posta;ad;soyad\n")).toBe(";");
    expect(parseCsv("e-posta;ad\na@x.co;Şule\n").rows).toEqual([["a@x.co", "Şule"]]);
  });
  it("does not count delimiters inside quoted headers", () => {
    expect(detectDelimiter('"a;b;c",d\n')).toBe(",");
  });
  it("handles a file without a trailing newline and CR-only endings", () => {
    expect(parseCsv("a,b\n1,2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r3,4").rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });
  it("returns empty structures for empty input", () => {
    expect(parseCsv("")).toMatchObject({ headers: [], rows: [] });
  });
  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1,,\n").rows).toEqual([["1", "", ""]]);
  });
});

describe("csv export", () => {
  it("neutralizes spreadsheet formula injection", () => {
    for (const evil of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)"]) {
      expect(escapeCsvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });
  it("quotes cells with delimiters, quotes and newlines", () => {
    expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("renders null/undefined as empty and dates as ISO", () => {
    expect(toCsvLine([null, undefined, new Date("2026-01-02T03:04:05Z")])).toBe(
      ",,2026-01-02T03:04:05.000Z\r\n",
    );
  });
  it("round-trips through the parser", () => {
    const rows = [
      ["a@x.co", 'Şule "Ş", Ltd'],
      ["b@x.co", "multi\nline"],
    ];
    const csv =
      CSV_BOM + toCsvLine(["email", "company"]) + rows.map(toCsvLine).join("");
    expect(parseCsv(csv).rows).toEqual(rows);
  });
});
