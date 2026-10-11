import { describe, expect, it } from "vitest";
import { applyUtm, applyUtmToText, tagUrl } from "./utm";

const utm = { enabled: true, source: "mailory", medium: "email", campaign: "yaz" };

describe("utm", () => {
  it("tags http(s) links, preserving existing query and escaping & in html", () => {
    const out = applyUtm('<a href="https://x.com/p?a=1&amp;b=2">x</a>', utm);
    expect(out).toContain(
      'href="https://x.com/p?a=1&amp;b=2&amp;utm_source=mailory&amp;utm_medium=email&amp;utm_campaign=yaz"',
    );
  });
  it("leaves mailto, tel, system links and author-tagged links alone", () => {
    const html =
      '<a href="mailto:a@b.co">m</a><a href="tel:+90">t</a><a href="https://app.test/u/1">u</a><a href="https://x.com/?utm_source=mine">x</a>';
    expect(applyUtm(html, utm, ["https://app.test/"])).toBe(html);
  });
  it("is a no-op when disabled", () => {
    const html = '<a href="https://x.com">x</a>';
    expect(applyUtm(html, { ...utm, enabled: false })).toBe(html);
  });
  it("tags plain-text urls and ignores unparseable ones", () => {
    expect(applyUtmToText("Bak: https://x.com/a", utm)).toBe(
      "Bak: https://x.com/a?utm_source=mailory&utm_medium=email&utm_campaign=yaz",
    );
    expect(tagUrl("https://", utm)).toBe("https://");
  });
});
