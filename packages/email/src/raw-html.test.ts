import { describe, expect, it } from "vitest";
import { blankTemplate } from "./library";
import { DEFAULT_BRAND, type EmailDoc } from "@mailory/core/shared";
import { renderEmail } from "./render";
import { sanitizeRawCss } from "./raw-css";
import { rawHtmlToText, sanitizeRawEmailHtml } from "./raw-html";

const ctx = { appUrl: "https://app.test" };
const rawDoc = (html: string, css = ""): EmailDoc => ({
  ...blankTemplate(DEFAULT_BRAND),
  blocks: [],
  raw: { html, css },
});
const values = {
  first_name: "Ayşe",
  unsubscribe_url: "https://app.test/u/abc",
  view_in_browser_url: "https://app.test/v/abc",
  email: "a@b.co",
};

describe("raw email HTML sanitizer", () => {
  it("removes scripts, handlers, forms, iframes, objects and style tags from the body", () => {
    const out = sanitizeRawEmailHtml(
      `<div onclick="x()"><script>alert(1)</script><iframe src="https://e.com"></iframe><form action="https://e.com"><input name=a></form><object data="x"></object><style>body{x}</style><p onmouseover="y()">ok</p></div>`,
      ctx,
    );
    expect(out).toContain("ok");
    expect(out).not.toMatch(
      /script|iframe|form|input|object|onclick|onmouseover|<style/i,
    );
  });
  it("keeps layout tables, bgcolor, classes and safe inline styles", () => {
    const out = sanitizeRawEmailHtml(
      `<table class="wrap" width="600" bgcolor="#fff" cellpadding="0"><tr><td style="padding:10px;font-family:Arial;color:#333;background-color:#eee">x</td></tr></table>`,
      ctx,
    );
    expect(out).toContain('class="wrap"');
    expect(out).toContain("bgcolor");
    expect(out).toMatch(/padding:10px/);
    expect(out).toMatch(/font-family:Arial/);
  });
  it("drops dangerous inline styles but keeps the safe ones next to them", () => {
    const out = sanitizeRawEmailHtml(
      `<div style="position:fixed;top:0;color:#111;background:url(javascript:alert(1));width:expression(alert(1))">x</div>`,
      ctx,
    );
    expect(out).toMatch(/color:#111/);
    expect(out).not.toMatch(/position|expression|javascript|top:/i);
  });
  it("keeps https background images but not http, data or relative ones", () => {
    expect(
      sanitizeRawEmailHtml(
        `<td style="background-image:url('https://cdn.test/a.png')">x</td>`,
        ctx,
      ),
    ).toContain("https://cdn.test/a.png");
    for (const bad of [
      "http://cdn.test/a.png",
      "data:image/png;base64,AAAA",
      "../a.png",
    ])
      expect(
        sanitizeRawEmailHtml(`<td style="background-image:url('${bad}')">x</td>`, ctx),
      ).not.toContain("url(");
  });
  it("links: only absolute http(s)/mailto/tel or merge tokens survive; javascript is removed", () => {
    const out = sanitizeRawEmailHtml(
      `<a href="javascript:alert(1)">a</a><a href="/relative">b</a><a href="https://ok.test/x">c</a><a href="{{unsubscribe_url}}">d</a><a href="mailto:x@y.z">e</a><a href="data:text/html,hi">f</a>`,
      ctx,
    );
    expect(out).not.toMatch(/javascript|\/relative|data:/);
    expect(out).toContain('href="https://ok.test/x"');
    expect(out).toContain('href="{{unsubscribe_url}}"');
    expect(out).toContain("mailto:x@y.z");
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });
  it("images: https and our own assets only", () => {
    const id = "0b9d9f0e-1111-4222-8333-444455556666";
    const out = sanitizeRawEmailHtml(
      `<img src="https://cdn.test/a.png"><img src="/a/${id}"><img src="http://cdn.test/b.png"><img src="data:image/png;base64,AAAA"><img src="cid:x"><img src="relative.png">`,
      ctx,
    );
    expect(out).toContain("https://cdn.test/a.png");
    expect(out).toContain(`https://app.test/a/${id}`);
    expect(out).not.toMatch(/http:\/\/cdn|data:|cid:|relative/);
  });
  it("drops class/id values that are not plain identifiers", () => {
    const out = sanitizeRawEmailHtml(
      `<p class='a" onclick="x'>t</p><p id="ok-1">u</p>`,
      ctx,
    );
    expect(out).not.toMatch(/onclick/);
    expect(out).toContain('id="ok-1"');
  });
});

describe("raw email CSS sanitizer", () => {
  it("keeps class rules and @media queries", () => {
    const css = sanitizeRawCss(
      `.wrap{width:600px;margin:0 auto} @media only screen and (max-width:620px){.wrap{width:100%!important}}`,
    );
    expect(css).toContain(".wrap{width:600px;margin:0 auto}");
    expect(css).toMatch(
      /@media only screen and \(max-width:620px\)\{\.wrap\{width:100% ?!important\}\}/,
    );
  });
  it("drops imports/font-face/keyframes, except Google Fonts imports", () => {
    const css = sanitizeRawCss(
      `@import url('https://evil.test/x.css'); @import url('https://fonts.googleapis.com/css?family=Roboto'); @font-face{font-family:x;src:url(https://e.test/f.woff)} @keyframes k{from{color:red}} p{color:#000}`,
    );
    expect(css).toContain("fonts.googleapis.com");
    expect(css).not.toMatch(/evil|font-face|keyframes|e\.test/);
    expect(css).toContain("p{color:#000}");
  });
  it("drops dangerous declarations and properties", () => {
    const css = sanitizeRawCss(
      `.a{position:absolute;z-index:9;content:"x";color:red;background:url(http://e.test/a.png);width:expression(1);behavior:url(x.htc);-moz-binding:url(x)}`,
    );
    expect(css).toBe(".a{color:red}");
  });
  it("drops rules with suspicious selectors and tolerates unbalanced input", () => {
    expect(sanitizeRawCss(`a{color:red} b<script>{color:red} c{color:blue`)).toBe(
      "a{color:red}",
    );
    expect(() => sanitizeRawCss("}}}{{{ @media")).not.toThrow();
  });
});

describe("renderEmail for an imported HTML email", () => {
  it("merges tokens (escaped), resolves href tokens, wraps in a document and builds a text alternative", () => {
    const doc = rawDoc(
      `<table><tr><td>Merhaba {{first_name}}!</td></tr></table><a href="{{unsubscribe_url}}">Abonelikten çık</a><a href="https://shop.test/?n={{first_name}}">Shop</a>`,
      ".x{color:red}",
    );
    const out = renderEmail(doc, {
      values,
      appUrl: "https://app.test",
      subject: "Konu",
    });
    expect(out.html.startsWith("<!doctype html>")).toBe(true);
    expect(out.html).toContain("Merhaba Ayşe!");
    expect(out.html).toContain('href="https://app.test/u/abc"');
    expect(out.html).toContain("https://shop.test/?n=Ay%C5%9Fe");
    expect(out.html).toContain("<style>");
    expect(out.text).toContain("Merhaba Ayşe!");
    expect(out.text).toContain("Abonelikten çık (https://app.test/u/abc)");
  });
  it("escapes hostile contact values and re-sanitizes stored HTML that was tampered with", () => {
    const doc = rawDoc(
      `<p>{{first_name}}</p><script>alert(1)</script><a href="javascript:x">y</a>`,
    );
    const out = renderEmail(doc, {
      values: { ...values, first_name: `<img src=x onerror=alert(1)>` },
      appUrl: "https://app.test",
    });
    expect(out.html).not.toMatch(/<script|<img src=x|javascript:/i);
    expect(out.html).toContain("&lt;img");
  });
  it("reports unknown merge keys", () => {
    const out = renderEmail(rawDoc(`<p>{{nonexistent}}</p>`), {
      values,
      appUrl: "https://app.test",
    });
    expect(out.unknownKeys).toContain("nonexistent");
  });
  it("text alternative helper keeps link targets", () => {
    expect(
      rawHtmlToText(`<p>Hi</p><a href="https://x.test/a?b=1&amp;c=2">Go</a>`),
    ).toContain("Go (https://x.test/a?b=1&c=2)");
  });
});
