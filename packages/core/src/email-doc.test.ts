import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  collectMergeKeys,
  createBlock,
  createEmptyDoc,
  isHexColor,
  isKnownMergeKey,
  isSafeUrl,
  newBlockId,
  walkBlocks,
} from "./email-doc";

describe("isSafeUrl (allow-list)", () => {
  it("accepts http(s) and, when allowed, mailto/tel", () => {
    expect(isSafeUrl("https://example.com/a?b=1")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("mailto:a@b.co")).toBe(false);
    expect(isSafeUrl("mailto:a@b.co", { allowMailto: true })).toBe(true);
    expect(isSafeUrl("tel:+905551112233", { allowMailto: true })).toBe(true);
  });
  it("rejects script-bearing and malformed schemes, including obfuscated ones", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.example/x",
      "/relative/path",
      "file:///etc/passwd",
      "",
      "https://exa mple.com",
    ]) {
      expect(isSafeUrl(bad, { allowMailto: true }), bad).toBe(false);
    }
  });
  it("allows merge tokens in a query, and the two system link tokens as a whole value", () => {
    expect(isSafeUrl("https://example.com/?e={{email}}")).toBe(true);
    expect(isSafeUrl("{{unsubscribe_url}}")).toBe(true);
    expect(isSafeUrl("{{ view_in_browser_url }}")).toBe(true);
    expect(isSafeUrl("{{first_name}}")).toBe(false); // an arbitrary field must not become a whole URL
    expect(isSafeUrl("{{email}}:alert(1)")).toBe(false);
  });
});

describe("isHexColor", () => {
  it("accepts only #rgb / #rrggbb", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#A1b2C3")).toBe(true);
    for (const bad of [
      "red",
      "#ffff",
      "#ggg",
      "url(x)",
      "#fff;background:url(x)",
      "expression(1)",
      "",
    ])
      expect(isHexColor(bad), bad).toBe(false);
  });
});

describe("blocks and merge keys", () => {
  it("creates every block type with a unique id", () => {
    const ids = new Set(BLOCK_TYPES.map((t) => createBlock(t).id));
    expect(ids.size).toBe(BLOCK_TYPES.length);
    expect(newBlockId()).not.toBe(newBlockId());
  });
  it("collects merge keys from nested blocks, preheader and links", () => {
    const doc = createEmptyDoc({ preheader: "Selam {{first_name}}" });
    doc.blocks.push({
      id: "1",
      type: "paragraph",
      text: "{{company|Şirketiniz}} için",
      align: "left",
    });
    doc.blocks.push({
      id: "2",
      type: "columns",
      columns: [
        [
          {
            id: "3",
            type: "button",
            label: "Git",
            href: "https://x.co/?u={{email}}",
            variant: "solid",
            align: "left",
          },
        ],
        [],
      ],
    });
    expect(collectMergeKeys(doc).sort()).toEqual(["company", "email", "first_name"]);
  });
  it("knows standard, system and custom keys", () => {
    expect(isKnownMergeKey("first_name")).toBe(true);
    expect(isKnownMergeKey("unsubscribe_url")).toBe(true);
    expect(isKnownMergeKey("custom.stage", ["stage"])).toBe(true);
    expect(isKnownMergeKey("custom.stage", [])).toBe(false);
    expect(isKnownMergeKey("nope")).toBe(false);
  });
  it("walkBlocks visits column children with their parent", () => {
    const doc = createEmptyDoc();
    doc.blocks.push(createBlock("columns"));
    const seen: string[] = [];
    walkBlocks(doc, (b, parent) => seen.push(`${b.type}${parent ? "*" : ""}`));
    expect(seen).toEqual(["columns", "paragraph*", "paragraph*"]);
  });
});
