import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND,
  collectMergeKeys,
  isKnownMergeKey,
  type BrandKit,
} from "@mailory/core/shared";
import { emailDocSchema } from "@mailory/validation";
import { buildMergeValues } from "./merge";
import { LIBRARY_TEMPLATES, blankTemplate, findLibraryTemplate } from "./library";
import { renderEmail } from "./render";

const brand: BrandKit = {
  ...DEFAULT_BRAND,
  logoAssetId: "123e4567-e89b-42d3-a456-426614174000",
  primaryColor: "#0a7f5a",
  buttonColor: "#0a7f5a",
  linkColor: "#0a7f5a",
  font: "georgia",
  footerText: "Acme A.Ş.\nÇankaya, Ankara",
  socialLinks: [{ network: "linkedin", url: "https://linkedin.com/company/acme" }],
};
const values = buildMergeValues(
  { firstName: "Ayşe", company: "Örnek" },
  {
    unsubscribeUrl: "https://app.test/u/1",
    viewInBrowserUrl: "https://app.test/v/1",
    orgName: "Acme",
  },
);

describe("template library", () => {
  it("covers the requested categories and has unique keys", () => {
    expect(new Set(LIBRARY_TEMPLATES.map((t) => t.key)).size).toBe(
      LIBRARY_TEMPLATES.length,
    );
    const cats = new Set(LIBRARY_TEMPLATES.map((t) => t.category));
    for (const c of [
      "newsletter",
      "event",
      "welcome",
      "investor",
      "product_launch",
      "announcement",
      "startup",
      "recruitment",
    ])
      expect(cats.has(c as never), c).toBe(true);
  });
  for (const t of LIBRARY_TEMPLATES) {
    describe(t.key, () => {
      for (const [label, b] of [
        ["default brand", DEFAULT_BRAND],
        ["custom brand", brand],
      ] as const) {
        it(`validates, renders cleanly and only uses known merge fields (${label})`, () => {
          const doc = t.build(b);
          expect(emailDocSchema.safeParse(doc).error?.issues ?? []).toEqual([]);
          for (const key of collectMergeKeys(doc))
            expect(isKnownMergeKey(key), key).toBe(true);
          const r = renderEmail(doc, {
            values,
            appUrl: "https://app.test",
            brandLogoUrl: "/a/123e4567-e89b-42d3-a456-426614174000",
          });
          expect(r.unknownKeys).toEqual([]);
          expect(r.warnings).toEqual([]);
          expect(r.html).toContain("Abonelikten çık");
          expect(r.text.length).toBeGreaterThan(40);
        });
      }
      it("ends with an unsubscribe footer and applies the brand", () => {
        const doc = t.build(brand);
        expect(doc.blocks.at(-1)).toMatchObject({
          type: "footer",
          showUnsubscribe: true,
        });
        expect(doc.settings).toMatchObject({ buttonColor: "#0a7f5a", font: "georgia" });
        expect(doc.blocks[0]).toMatchObject({
          type: "logo",
          src: `/a/${brand.logoAssetId}`,
        });
      });
    });
  }
  it("omits the logo block when the brand has none", () => {
    expect(
      findLibraryTemplate("newsletter")!
        .build(DEFAULT_BRAND)
        .blocks.some((b) => b.type === "logo"),
    ).toBe(false);
  });
  it("blank template is valid and branded", () => {
    const doc = blankTemplate(brand);
    expect(emailDocSchema.safeParse(doc).success).toBe(true);
    expect(doc.blocks.at(-1)).toMatchObject({
      type: "footer",
      text: "Acme A.Ş.\nÇankaya, Ankara",
    });
  });
  it("unknown library keys return null", () =>
    expect(findLibraryTemplate("nope")).toBeNull());
});
