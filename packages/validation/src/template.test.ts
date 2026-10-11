import { describe, expect, it } from "vitest";
import { createBlock, createEmptyDoc, type EmailDoc } from "@mailory/core";
import { brandKitSchema, emailDocSchema } from "./template";

const docWith = (...blocks: unknown[]) => ({ ...createEmptyDoc(), blocks }) as unknown;
const ok = (d: unknown) => emailDocSchema.safeParse(d).success;

describe("emailDocSchema", () => {
  it("accepts a document built from every default block", () => {
    const doc = createEmptyDoc();
    for (const t of [
      "heading",
      "paragraph",
      "image",
      "button",
      "divider",
      "spacer",
      "social",
      "columns",
      "quote",
      "logo",
      "video",
      "html",
      "footer",
    ] as const) {
      const b = createBlock(t);
      if (b.type === "video") b.thumbnailSrc = "";
      doc.blocks.push(b);
    }
    expect(emailDocSchema.safeParse(doc).error?.issues ?? []).toEqual([]);
  });
  it("rejects dangerous links and image sources", () => {
    const button = { ...createBlock("button"), href: "javascript:alert(1)" };
    expect(ok(docWith(button))).toBe(false);
    expect(
      ok(
        docWith({
          ...createBlock("image"),
          src: "data:image/svg+xml,<svg onload=alert(1)>",
        }),
      ),
    ).toBe(false);
    expect(
      ok(docWith({ ...createBlock("image"), src: "https://cdn.example.com/a.png" })),
    ).toBe(true);
    expect(
      ok(
        docWith({
          ...createBlock("image"),
          src: "/a/123e4567-e89b-42d3-a456-426614174000",
        }),
      ),
    ).toBe(true);
    expect(ok(docWith({ ...createBlock("image"), src: "/a/../../etc/passwd" }))).toBe(
      false,
    );
  });
  it("rejects CSS-injecting colours and unknown fonts", () => {
    const doc = createEmptyDoc() as EmailDoc;
    expect(
      ok({
        ...doc,
        settings: { ...doc.settings, textColor: "red;background:url(//evil)" },
      }),
    ).toBe(false);
    expect(ok({ ...doc, settings: { ...doc.settings, font: "comic" } })).toBe(false);
  });
  it("rejects unknown block types, nested columns and duplicate ids", () => {
    expect(ok(docWith({ id: "x", type: "script", src: "x" }))).toBe(false);
    const nested = {
      id: "c1",
      type: "columns",
      columns: [[createBlock("columns")], []],
    };
    expect(ok(docWith(nested))).toBe(false);
    const a = createBlock("divider");
    expect(ok(docWith(a, { ...createBlock("spacer"), id: a.id }))).toBe(false);
  });
  it("bounds block count and column count", () => {
    expect(
      ok(docWith(...Array.from({ length: 101 }, () => createBlock("divider")))),
    ).toBe(false);
    expect(ok(docWith({ id: "c", type: "columns", columns: [[]] }))).toBe(false);
  });
  it("buttons need a real URL; images may leave it empty", () => {
    expect(ok(docWith({ ...createBlock("button"), href: "" }))).toBe(false);
    expect(ok(docWith({ ...createBlock("image"), href: "" }))).toBe(true);
  });
});

describe("brandKitSchema", () => {
  const base = {
    logoAssetId: null,
    primaryColor: "#4a3fd6",
    textColor: "#222222",
    backgroundColor: "#ffffff",
    linkColor: "#4a3fd6",
    buttonColor: "#4a3fd6",
    buttonTextColor: "#ffffff",
    font: "sans",
    buttonRadius: 6,
    footerText: "Adres",
    socialLinks: [],
  };
  it("accepts a valid kit and rejects bad colours / social urls", () => {
    expect(brandKitSchema.safeParse(base).success).toBe(true);
    expect(brandKitSchema.safeParse({ ...base, primaryColor: "blue" }).success).toBe(
      false,
    );
    expect(
      brandKitSchema.safeParse({
        ...base,
        socialLinks: [{ network: "x", url: "javascript:1" }],
      }).success,
    ).toBe(false);
  });
});
