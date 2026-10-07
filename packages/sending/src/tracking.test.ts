import { describe, expect, it } from "vitest";
import {
  SCANNER_CLICK_MS,
  classifyDevice,
  hashIp,
  injectPixel,
  looksLikeBot,
  openPixelHtml,
  rewriteLinks,
  trackableUrls,
} from "./tracking";

const APP = "https://app.test";
const skip = [`${APP}/unsubscribe/`, `${APP}/view/`];

describe("link rewriting", () => {
  const html = `<a href="https://shop.com/a?x=1&amp;y=2">a</a><a href="mailto:a@b.co">m</a><a href="${APP}/unsubscribe/tok">u</a><a href="https://shop.com/a?x=1&amp;y=2">dup</a><a href="${APP}/view/tok">v</a>`;
  it("finds distinct external http(s) destinations only", () => {
    expect(trackableUrls(html, skip)).toEqual(["https://shop.com/a?x=1&y=2"]);
  });
  it("rewrites those and nothing else", () => {
    const out = rewriteLinks(
      html,
      new Map([["https://shop.com/a?x=1&y=2", `${APP}/c/T`]]),
      "html",
    );
    expect(out.match(/href="https:\/\/app\.test\/c\/T"/g)).toHaveLength(2);
    expect(out).toContain('href="mailto:a@b.co"');
    expect(out).toContain(`href="${APP}/unsubscribe/tok"`);
    expect(out).not.toContain("shop.com");
  });
  it("rewrites plain-text urls and leaves unknown ones", () => {
    const out = rewriteLinks(
      "Bak https://shop.com/x ve https://other.com/",
      new Map([["https://shop.com/x", `${APP}/c/T`]]),
      "text",
    );
    expect(out).toBe(`Bak ${APP}/c/T ve https://other.com/`);
  });
  it("is a no-op with no redirects", () => {
    expect(rewriteLinks(html, new Map(), "html")).toBe(html);
  });
});

describe("pixel", () => {
  it("is placed before </body>, or appended", () => {
    const px = openPixelHtml(`${APP}/o/T.gif`);
    expect(injectPixel("<html><body>x</body></html>", px)).toBe(
      `<html><body>x${px}</body></html>`,
    );
    expect(injectPixel("x", px)).toBe(`x${px}`);
    expect(px).toContain('width="1"');
  });
});

describe("bot detection and privacy", () => {
  const chrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
  it("classifies devices coarsely", () => {
    expect(classifyDevice(chrome)).toBe("desktop");
    expect(
      classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148"),
    ).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe("tablet");
    expect(classifyDevice("python-requests/2.31")).toBe("bot");
    expect(classifyDevice("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("bot");
    expect(classifyDevice(null)).toBe("unknown");
  });
  it("flags scanners: bot agents, prefetch headers and instant clicks — but not instant opens", () => {
    expect(looksLikeBot({ ua: "curl/8", type: "click", msSinceSent: 60_000 })).toBe(
      true,
    );
    expect(
      looksLikeBot({
        ua: chrome,
        purpose: "prefetch",
        type: "open",
        msSinceSent: 60_000,
      }),
    ).toBe(true);
    expect(
      looksLikeBot({ ua: chrome, type: "click", msSinceSent: SCANNER_CLICK_MS - 1 }),
    ).toBe(true);
    expect(
      looksLikeBot({ ua: chrome, type: "click", msSinceSent: SCANNER_CLICK_MS + 1 }),
    ).toBe(false);
    // Mail proxies fetch the pixel within a second of delivery; that is a real open.
    expect(looksLikeBot({ ua: chrome, type: "open", msSinceSent: 500 })).toBe(false);
    expect(looksLikeBot({ ua: chrome, type: "click", msSinceSent: null })).toBe(false);
  });
  it("hashes IPs with a daily-rotating salt and never returns the address", () => {
    const d1 = new Date("2026-03-01T10:00:00Z");
    const d2 = new Date("2026-03-02T10:00:00Z");
    const h = hashIp("secret-secret-secret-secret-secret-1", "203.0.113.9", d1)!;
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain("203");
    expect(hashIp("secret-secret-secret-secret-secret-1", "203.0.113.9", d1)).toBe(h);
    expect(hashIp("secret-secret-secret-secret-secret-1", "203.0.113.9", d2)).not.toBe(
      h,
    );
    expect(hashIp("other-secret-secret-secret-secret-2", "203.0.113.9", d1)).not.toBe(
      h,
    );
    expect(hashIp("s", null, d1)).toBeNull();
  });
});
