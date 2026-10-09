import { describe, expect, it } from "vitest";
import {
  createBlock,
  createEmptyDoc,
  type Block,
  type BlockType,
  type EmailDoc,
} from "@mailory/core/shared";
import { applyMerge, buildMergeValues } from "./merge";
import { inlineToHtml, inlineToText } from "./markup";
import { renderEmail } from "./render";
import { sanitizeHtmlBlock } from "./sanitize";

const values = buildMergeValues(
  {
    firstName: "Ayşe",
    lastName: "Yılmaz",
    email: "ayse@example.com",
    company: "Örnek A.Ş.",
  },
  {
    unsubscribeUrl: "https://app.test/u/abc",
    viewInBrowserUrl: "https://app.test/v/abc",
    orgName: "Acme",
  },
);
const doc = (...blocks: Block[]): EmailDoc => ({ ...createEmptyDoc(), blocks });
const render = (d: EmailDoc, v = values) =>
  renderEmail(d, { values: v, appUrl: "https://app.test" });
/** createBlock + overrides, typed as Block (the spread of a union loses the discriminant). */
const mk = (type: BlockType, patch: Record<string, unknown> = {}) =>
  ({ ...createBlock(type), ...patch }) as Block;
const para = (text: string): Block => ({
  id: "p",
  type: "paragraph",
  text,
  align: "left",
});

describe("applyMerge", () => {
  const id = (v: string) => v;
  it("substitutes values and falls back when empty or missing", () => {
    expect(
      applyMerge("Merhaba {{first_name|dostum}}", { first_name: "Ayşe" }, id),
    ).toBe("Merhaba Ayşe");
    expect(applyMerge("Merhaba {{first_name|dostum}}", { first_name: "" }, id)).toBe(
      "Merhaba dostum",
    );
    expect(applyMerge("Merhaba {{first_name|dostum}}", {}, id)).toBe("Merhaba dostum");
    expect(applyMerge("Merhaba {{first_name}}!", {}, id)).toBe("Merhaba !");
  });
  it("is case-insensitive on keys, tolerant of spaces, and reports unknown keys", () => {
    const unknown = new Set<string>();
    expect(
      applyMerge("{{ FIRST_NAME }} {{nope}}", { first_name: "A" }, id, unknown),
    ).toBe("A ");
    expect([...unknown]).toEqual(["nope"]);
  });
  it("does not re-interpret merged values as tokens (no second-order injection)", () => {
    expect(
      applyMerge(
        "{{first_name}}",
        { first_name: "{{email}}", email: "secret@x.co" },
        id,
      ),
    ).toBe("{{email}}");
  });
});

describe("inline markup", () => {
  it("never lets authors inject HTML", () => {
    const out = inlineToHtml(
      "<script>alert(1)</script><img src=x onerror=alert(1)> \"q\" 's'",
      "#000",
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toMatch(/onerror=alert\(1\)>/);
  });
  it("renders bold, italic, links and line breaks", () => {
    const out = inlineToHtml(
      "**kalın** ve _italik_\n[site](https://example.com?a=1&b=2)",
      "#123456",
    );
    expect(out).toContain("<strong>kalın</strong>");
    expect(out).toContain("<em>italik</em>");
    expect(out).toContain("<br>");
    expect(out).toContain('href="https://example.com?a=1&amp;b=2"');
    expect(out).toContain("color:#123456");
  });
  it("drops unsafe link targets but keeps the label", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "JAVASCRIPT:1"]) {
      const out = inlineToHtml(`[tıkla](${bad})`, "#000");
      // No link is produced and no scheme is emitted. (A URL containing ")" ends at the first ")" — a
      // known limitation of the lite syntax — so a stray ")" may remain after the label.)
      expect(out.startsWith("tıkla")).toBe(true);
      expect(out).not.toContain("<a");
      expect(out).not.toMatch(/javascript|data:/i);
    }
  });
  it("does not treat snake_case or file_names_like_this as italic", () => {
    expect(inlineToHtml("my_file_name.txt", "#000")).toBe("my_file_name.txt");
  });
  it("plain-text twin shows link targets", () => {
    expect(inlineToText("**a** [b](https://x.co)")).toBe("a b (https://x.co)");
  });
});

describe("renderEmail — security", () => {
  it("escapes hostile contact data in body text", () => {
    const v = {
      ...values,
      first_name: '<img src=x onerror=alert(1)>"><script>alert(2)</script>',
    };
    const { html } = render(doc(para("Merhaba {{first_name}}")), v);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("URL-encodes contact data placed inside a link", () => {
    const btn: Block = {
      id: "b",
      type: "button",
      label: "Git",
      href: "https://example.com/?e={{email}}&n={{first_name}}",
      variant: "solid",
      align: "left",
    };
    const v = {
      ...values,
      first_name: 'x" onmouseover="alert(1)',
      email: "a+b@example.com",
    };
    const { html } = render(doc(btn), v);
    expect(html).toContain("e=a%2Bb%40example.com");
    expect(html).not.toContain('onmouseover="alert');
    expect(html).toContain("n=x%22%20onmouseover%3D%22alert(1)");
  });
  it("refuses unsafe hrefs even if validation were bypassed", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "  javascript:1",
      "",
    ]) {
      const b: Block = {
        id: "b",
        type: "button",
        label: "x",
        href: bad,
        variant: "solid",
        align: "left",
      };
      const { html } = render(doc(b));
      expect(html).not.toMatch(/javascript:/i);
      expect(html).toContain('href="#"');
    }
  });
  it("a contact value cannot turn a link into a script URL via a whole-value token", () => {
    const b: Block = {
      id: "b",
      type: "button",
      label: "Çık",
      href: "{{unsubscribe_url}}",
      variant: "solid",
      align: "left",
    };
    const { html } = render(doc(b), {
      ...values,
      unsubscribe_url: "javascript:alert(1)",
    });
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('href="#"');
  });
  it("strips scripts, handlers and bad URLs from the HTML block", () => {
    const evil =
      '<p onclick="x()">ok</p><script>alert(1)</script><a href="javascript:alert(1)">a</a><iframe src="https://evil"></iframe><img src="x" onerror="alert(1)"><style>body{display:none}</style><svg onload=alert(1)>';
    const out = sanitizeHtmlBlock(evil);
    expect(out).toContain("ok");
    for (const needle of [
      "<script",
      "onclick",
      "javascript:",
      "<iframe",
      "onerror",
      "<style",
      "<svg",
      "onload",
    ])
      expect(out.toLowerCase(), needle).not.toContain(needle);
  });
  it("drops images without an absolute http(s) source and strips relative or token-less hrefs", () => {
    const out = sanitizeHtmlBlock(
      '<img src="x"><img src="/relative.png"><img src="javascript:alert(1)"><img src="https://cdn.example.com/a.png" alt="ok"><a href="/relative">r</a><a href="page.html">p</a><a href="{{first_name}}">t</a><a href="{{unsubscribe_url}}">u</a><a href="https://x.co">abs</a>',
    );
    expect(out.match(/<img\b/g)).toHaveLength(1);
    expect(out).toContain('src="https://cdn.example.com/a.png"');
    for (const bad of ['href="/relative"', 'href="page.html"', 'href="{{first_name}}"'])
      expect(out).not.toContain(bad);
    expect(out).toContain('href="{{unsubscribe_url}}"');
    expect(out).toContain('href="https://x.co"');
  });
  it("keeps safe formatting in the HTML block and forces noopener on links", () => {
    const out = sanitizeHtmlBlock(
      '<p style="color:#ff0000;position:fixed">Merhaba <b>dünya</b> <a href="https://x.co">link</a></p>',
    );
    expect(out).toContain("<b>dünya</b>");
    expect(out).toContain("color:#ff0000");
    expect(out).not.toContain("position");
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });
  it("never emits executable markup anywhere in a full document", () => {
    const d = doc(
      {
        id: "1",
        type: "heading",
        text: "<script>alert(1)</script>",
        level: 1,
        align: "left",
      },
      { id: "2", type: "html", html: "<script>alert(2)</script><b>x</b>" },
      {
        id: "3",
        type: "image",
        src: "https://x.co/a.png",
        alt: '"><script>alert(3)</script>',
        href: "",
        widthPercent: 100,
        align: "center",
      },
      {
        id: "4",
        type: "quote",
        text: "<img src=x onerror=alert(4)>",
        author: "<b>x</b>",
      },
    );
    const { html } = render(d);
    expect(html.match(/<script/gi)).toBeNull();
    // "onerror=" may appear as escaped *text*; what must never exist is a real tag carrying a handler.
    expect(html).not.toMatch(/<[^>]*\bon\w+\s*=/i);
    expect(html.match(/<img\b/gi)).toHaveLength(1); // only the legitimate image block
  });
});

describe("renderEmail — output quality", () => {
  it("produces a table-based, inline-styled, responsive document with no external CSS or JS", () => {
    const { html } = render(doc(para("x")));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("@media only screen and (max-width:620px)");
    expect(html).not.toMatch(/<link\b|<script\b|@import|url\(/i);
    expect(html).toMatch(/<p style="[^"]*font-size:16px/);
  });
  it("renders every block type without throwing", () => {
    const d = doc(
      ...(
        [
          "heading",
          "paragraph",
          "button",
          "divider",
          "spacer",
          "social",
          "columns",
          "quote",
          "html",
          "footer",
        ] as const
      ).map((t) => createBlock(t)),
      mk("image", { src: "https://x.co/a.png", alt: "A" }),
      mk("logo", { src: "/a/123e4567-e89b-42d3-a456-426614174000" }),
      mk("video", { thumbnailSrc: "https://x.co/v.png" }),
    );
    const r = render(d);
    expect(r.html.length).toBeGreaterThan(1000);
    expect(r.html).toContain("https://app.test/a/123e4567-e89b-42d3-a456-426614174000");
  });
  it("applies personalization with fallbacks and reports unknown fields", () => {
    const r = render(doc(para("Merhaba {{first_name|dostum}} — {{bogus}}")), {
      ...values,
      first_name: "",
    });
    expect(r.html).toContain("Merhaba dostum — ");
    expect(r.unknownKeys).toEqual(["bogus"]);
  });
  it("adds a hidden preheader and the unsubscribe link in the footer", () => {
    const d = doc(mk("footer", { text: "Acme · Ankara" }));
    d.settings.preheader = "Önizleme metni";
    const { html } = render(d);
    expect(html).toContain("display:none");
    expect(html).toContain("Önizleme metni");
    expect(html).toContain('href="https://app.test/u/abc"');
    expect(html).toContain("Abonelikten çık");
  });
  it("skips image/logo blocks that have no source and warns instead of emitting a broken <img>", () => {
    const r = render(doc(createBlock("image"), createBlock("logo")));
    expect(r.html).not.toContain("<img");
    expect(r.warnings.map((w) => w.code).sort()).toEqual([
      "image_missing_src",
      "logo_missing",
    ]);
  });
  it("uses the brand logo for an empty logo block", () => {
    const r = renderEmail(doc(createBlock("logo")), {
      values,
      appUrl: "https://app.test",
      brandLogoUrl: "/a/123e4567-e89b-42d3-a456-426614174000",
    });
    expect(r.html).toContain("https://app.test/a/123e4567");
    expect(r.warnings).toEqual([]);
  });
  it("uses font stacks without double quotes (they would break style attributes)", () => {
    const d = doc(para("x"));
    d.settings.font = "georgia";
    const { html } = render(d);
    expect(html).toContain("'Times New Roman'");
    expect(html).not.toMatch(/style="[^"]*"Times/);
  });
  it("renders columns as stacking cells", () => {
    const { html } = render(doc(createBlock("columns")));
    expect(html.match(/class="col"/g)).toHaveLength(2);
  });
});

describe("renderText", () => {
  it("builds a readable plain-text alternative", () => {
    const d = doc(
      { id: "1", type: "heading", text: "Duyuru", level: 1, align: "left" },
      para("Merhaba **{{first_name}}**, [site](https://example.com)"),
      {
        id: "3",
        type: "button",
        label: "Kayıt ol",
        href: "https://example.com/kayit",
        variant: "solid",
        align: "left",
      },
      mk("footer", { text: "Acme" }),
    );
    const { text } = render(d);
    expect(text).toContain("DUYURU");
    expect(text).toContain("Merhaba Ayşe, site (https://example.com)");
    expect(text).toContain("Kayıt ol: https://example.com/kayit");
    expect(text).toContain("Abonelikten çık: https://app.test/u/abc");
    expect(text).not.toMatch(/[<>]/);
  });
});
