import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("transliterates Turkish letters", () => {
    expect(slugify("Şişli Girişim Çözümleri")).toBe("sisli-girisim-cozumleri");
    expect(slugify("IĞDIR Ürün")).toBe("igdir-urun");
  });
  it("collapses punctuation and trims", () => {
    expect(slugify("  Acme -- Inc.!  ")).toBe("acme-inc");
  });
  it("falls back for names with no usable characters", () => {
    expect(slugify("!!!")).toBe("org");
  });
  it("caps length without a trailing dash", () => {
    const s = slugify("a".repeat(47) + " bbbbbb");
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });
});
