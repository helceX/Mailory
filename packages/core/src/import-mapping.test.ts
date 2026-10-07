import { describe, expect, it } from "vitest";
import { normalizeHeader, suggestMapping } from "./import-mapping";

describe("suggestMapping", () => {
  it("maps English and Turkish headers", () => {
    expect(
      suggestMapping(["E-posta", "Adı", "Soyadı", "Şirket", "Şehir", "Telefon"]),
    ).toEqual({
      "E-posta": "email",
      Adı: "first_name",
      Soyadı: "last_name",
      Şirket: "company",
      Şehir: "city",
      Telefon: "phone",
    });
  });
  it("suggests each target only once", () => {
    const m = suggestMapping(["Email", "E-mail Address"]);
    expect(Object.values(m).filter((t) => t === "email")).toHaveLength(1);
  });
  it("matches custom fields by label or key", () => {
    expect(
      suggestMapping(["Yatırım Turu"], [{ key: "round", label: "Yatırım Turu" }]),
    ).toEqual({ "Yatırım Turu": "custom:round" });
  });
  it("leaves unknown headers unmapped", () => {
    expect(suggestMapping(["Rastgele Sütun"])).toEqual({});
  });
  it("normalizes Turkish dotless i and diacritics", () => {
    expect(normalizeHeader("SOYADI")).toBe("soyadi");
    expect(normalizeHeader("İl")).toBe("il");
  });
});
