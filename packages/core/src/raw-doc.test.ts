import { describe, expect, it } from "vitest";
import { reviewContent } from "./deliverability";
import { collectMergeKeys, docHasUnsubscribe, type EmailDoc } from "./email-doc";

const base = (): EmailDoc => ({
  version: 1,
  settings: {
    width: 600,
    backgroundColor: "#ffffff",
    contentBackground: "#ffffff",
    textColor: "#000000",
    headingColor: "#000000",
    linkColor: "#0000ff",
    buttonColor: "#0000ff",
    buttonTextColor: "#ffffff",
    radius: 0,
    font: "sans",
    preheader: "",
  },
  blocks: [],
});
const raw = (html: string): EmailDoc => ({ ...base(), raw: { html, css: "" } });

describe("imported HTML documents", () => {
  it("count as unsubscribe-ready only with a real link target", () => {
    expect(docHasUnsubscribe(raw('<a href="{{unsubscribe_url}}">çık</a>'))).toBe(true);
    expect(docHasUnsubscribe(raw("<p>{{unsubscribe_url}}</p>"))).toBe(false);
    expect(docHasUnsubscribe(raw('<a href="https://x.test">x</a>'))).toBe(false);
    expect(docHasUnsubscribe(raw("<a href=' {{ unsubscribe_url }} '>x</a>"))).toBe(
      true,
    );
  });
  it("expose their merge keys", () => {
    expect(collectMergeKeys(raw("<p>{{first_name}} {{custom.plan}}</p>"))).toEqual(
      expect.arrayContaining(["first_name", "custom.plan"]),
    );
  });
  it("are reviewed by what a recipient sees: text, images, alt text, links", () => {
    const text = "Merhaba! ".repeat(40);
    const good = reviewContent({
      subject: "Haftalık bülten",
      preheader: "x",
      hasUnsubscribe: true,
      doc: raw(
        `<p>${text}</p><img src="https://c.test/a.png" alt="Logo"><a href="https://x.test/a">a</a>`,
      ),
    });
    expect(good.map((f) => f.code)).not.toEqual(
      expect.arrayContaining(["thin_content", "image_heavy"]),
    );
    expect(good.map((f) => f.code)).toContain("custom_html");

    const heavy = reviewContent({
      subject: "Haftalık bülten",
      preheader: "x",
      hasUnsubscribe: true,
      doc: raw('<img src="https://c.test/a.png"><a href="https://bit.ly/abc">x</a>'),
    });
    expect(heavy.map((f) => f.code)).toEqual(
      expect.arrayContaining(["image_heavy", "image_alt", "url_shortener"]),
    );
  });
});
