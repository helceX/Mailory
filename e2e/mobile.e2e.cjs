/* global CSS */
/*
 * Mobile + basic accessibility sweep: every main screen at phone width must not scroll horizontally, and every
 * page must have a main landmark, labelled controls and alt text. Run against `next dev` (see scripts/e2e.sh).
 */
const { BASE, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const { step, finish } = makeSteps();
const PAGES = [
  "/dashboard",
  "/audience/contacts",
  "/templates",
  "/campaigns",
  "/automations",
  "/analytics",
  "/deliverability",
  "/brand-kit",
  "/settings/members",
  "/settings/billing",
  "/settings/developers",
  "/domain-check",
];

(async () => {
  const { browser, page, problems } = await launch({ width: 375, height: 800 });
  await signUpWithOrg(page, "Mobil Test");
  for (const path of PAGES) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    if (!res || res.status() >= 400) {
      step(`${path} loads`, false, `status ${res?.status()}`);
      continue;
    }
    const r = await page.evaluate(() => {
      const el = document.documentElement;
      const wide = [...document.querySelectorAll("body *")]
        .filter((n) => {
          const b = n.getBoundingClientRect();
          return b.width > 0 && b.right > window.innerWidth + 1;
        })
        .filter((n) => !n.closest("[data-scroll-x], pre, [class*='overflow-x']"))
        .slice(0, 3)
        .map(
          (n) =>
            `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)}@${Math.round(n.getBoundingClientRect().right)}`,
        );
      const unnamed = (sel, has) =>
        [...document.querySelectorAll(sel)].filter((n) => !has(n)).length;
      const name = (n) =>
        (
          n.getAttribute("aria-label") ||
          n.getAttribute("aria-labelledby") ||
          n.textContent ||
          n.getAttribute("title") ||
          ""
        ).trim();
      return {
        overflow: el.scrollWidth - window.innerWidth,
        wide,
        main: document.querySelectorAll("main").length,
        h1: document.querySelectorAll("h1").length,
        noAlt: unnamed("img", (n) => n.hasAttribute("alt")),
        noName: unnamed(
          "button",
          (n) => name(n) || n.querySelector("img[alt]:not([alt=''])"),
        ),
        noLabel: unnamed(
          "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea",
          (n) =>
            n.getAttribute("aria-label") ||
            n.getAttribute("aria-labelledby") ||
            (n.id && document.querySelector(`label[for="${CSS.escape(n.id)}"]`)) ||
            n.closest("label"),
        ),
      };
    });
    step(
      `${path}: no horizontal scroll at 375px`,
      r.overflow <= 1,
      `over=${r.overflow} ${r.wide.join(" | ")}`,
    );
    step(
      `${path}: has main landmark and one h1`,
      r.main === 1 && r.h1 === 1,
      `main=${r.main} h1=${r.h1}`,
    );
    step(
      `${path}: images have alt, buttons and fields are named`,
      r.noAlt + r.noName + r.noLabel === 0,
      `noAlt=${r.noAlt} noName=${r.noName} noLabel=${r.noLabel}`,
    );
  }
  await browser.close();
  process.exit(finish(problems.filter((p) => !/status of 409/.test(p))) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
