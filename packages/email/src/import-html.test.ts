import { describe, expect, it } from "vitest";
import {
  ensureUnsubscribe,
  extractParts,
  findLocalRefs,
  mapMergeTags,
  replaceLocalRefs,
  resolveArchivePath,
} from "./import-html";

describe("extractParts", () => {
  it("separates body, styles and title and drops html/head wrappers and comments", () => {
    const src = `<!DOCTYPE html><html><head><meta charset="utf-8"><title> Hoş geldin </title><style>.a{color:red}</style><!--[if mso]><style>x{}</style><![endif]--></head><body><!-- c --><p class="a">Merhaba</p></body></html>`;
    const p = extractParts(src);
    expect(p.title).toBe("Hoş geldin");
    expect(p.css).toBe(".a{color:red}");
    expect(p.body).toBe('<p class="a">Merhaba</p>');
  });
  it("keeps the page background of <body bgcolor/style> as a wrapper", () => {
    const p = extractParts(
      `<body bgcolor="#eee" style="margin:0;background:#eee"><p>x</p></body>`,
    );
    expect(p.body).toContain('bgcolor="#eee"');
    expect(p.body).toContain("<p>x</p>");
  });
  it("copes with fragments and unclosed bodies", () => {
    expect(extractParts("<table><tr><td>x</td></tr></table>").body).toContain(
      "<table>",
    );
    expect(extractParts("<body><p>y</p>").body).toBe("<p>y</p>");
  });
});

describe("mapMergeTags", () => {
  it("translates Mailchimp, SendGrid-style and bracket tags", () => {
    const r = mapMergeTags(
      `Hi *|FNAME|* <a href="*|UNSUB|*">u</a> <a href="*|ARCHIVE|*">v</a> [email] %%last_name%% {{ first_name }}`,
    );
    expect(r.html).toContain("Hi {{first_name}}");
    expect(r.html).toContain('href="{{unsubscribe_url}}"');
    expect(r.html).toContain('href="{{view_in_browser_url}}"');
    expect(r.html).toContain("{{email}} {{last_name}} {{first_name}}");
    expect(r.mapped.length).toBeGreaterThan(3);
  });
});

describe("ensureUnsubscribe", () => {
  it("adds a footer only when there is no real unsubscribe link", () => {
    const a = ensureUnsubscribe("<p>x</p>");
    expect(a.added).toBe(true);
    expect(a.html).toContain('href="{{unsubscribe_url}}"');
    expect(ensureUnsubscribe(a.html).added).toBe(false);
    // A mention outside an href does not count.
    expect(ensureUnsubscribe("<p>{{unsubscribe_url}}</p>").added).toBe(true);
  });
});

describe("local asset references", () => {
  const html = `<img src="images/logo.png"><img src="https://cdn.test/x.png"><img src="data:image/png;base64,AA"><td background="bg.jpg"><div style="background:url('img/hero.jpg')"></div>`;
  it("finds only relative references", () => {
    expect(findLocalRefs(html, ".h{background:url(img/css.png)}").sort()).toEqual(
      ["bg.jpg", "images/logo.png", "img/css.png", "img/hero.jpg"].sort(),
    );
  });
  it("rewrites them everywhere", () => {
    const map = new Map([
      ["images/logo.png", "/a/1"],
      ["bg.jpg", "/a/2"],
      ["img/hero.jpg", "/a/3"],
    ]);
    const out = replaceLocalRefs(html, map);
    expect(out).toContain('src="/a/1"');
    expect(out).toContain('background="/a/2"');
    expect(out).toContain('url("/a/3")');
    expect(out).toContain("https://cdn.test/x.png");
  });
  it("resolves archive paths and refuses to escape the archive", () => {
    expect(resolveArchivePath("pack/email/index.html", "images/a.png")).toBe(
      "pack/email/images/a.png",
    );
    expect(resolveArchivePath("pack/email/index.html", "../shared/a.png?v=1")).toBe(
      "pack/shared/a.png",
    );
    expect(resolveArchivePath("index.html", "../../etc/passwd")).toBeNull();
    expect(resolveArchivePath("a/index.html", "%2e%2e/%2e%2e/x.png")).toBeNull();
  });
});
