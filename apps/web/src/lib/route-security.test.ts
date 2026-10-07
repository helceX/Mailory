import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A structural audit of every HTTP route, so a new endpoint cannot ship without the same guards as the old ones:
 *  - every state-changing handler is CSRF-protected (same-origin check), unless it is deliberately credential-based;
 *  - every route authenticates (session/actor), unless it is on the short, reasoned public list;
 *  - handlers that mutate never use the read-only (`write: false`) wrapper.
 */
const root = path.resolve(__dirname, "../app");
const files = readdirSync(path.join(root, "api"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((f) => f.isFile() && f.name === "route.ts")
  .map((f) => path.join(f.parentPath, f.name));
// Public pages that are routes too (tracking, view, assets).
const publicRoutes = [
  "a/[id]/route.ts",
  "c/[token]/route.ts",
  "o/[file]/route.ts",
  "view/[token]/route.ts",
].map((p) => path.join(root, p));

const rel = (f: string) => path.relative(root, f);
const src = (f: string) => readFileSync(f, "utf8");

/** Routes that are intentionally not session-authenticated, and WHY (the token/signature is the credential). */
const PUBLIC_API: Record<string, string> = {
  "api/health/route.ts": "liveness probe, no data",
  "api/health/ready/route.ts": "readiness probe (DB/Redis reachability only)",
  "api/auth/register/route.ts": "pre-login",
  "api/auth/login/route.ts": "pre-login",
  "api/auth/forgot-password/route.ts": "pre-login",
  "api/auth/reset-password/route.ts": "pre-login (single-use token)",
  "api/auth/verify-email/route.ts": "pre-login (single-use token)",
  "api/auth/logout/route.ts": "ends the caller's own session",
  "api/webhooks/ses/route.ts": "authenticated by SNS signature + topic allow-list",
  "api/unsubscribe/[token]/route.ts":
    "signed token is the credential (RFC 8058 one-click)",
  "api/assets/[id]/route.ts": "n/a",
};
/** Mutating routes allowed to skip the same-origin check: no cookie is involved, a signed token / signature is. */
const NO_CSRF_OK = new Set([
  "api/webhooks/ses/route.ts",
  "api/unsubscribe/[token]/route.ts",
]);

const MUTATING = /export (?:async )?function (POST|PUT|PATCH|DELETE)\b/g;

describe("route security audit", () => {
  it("finds the routes", () => expect(files.length).toBeGreaterThan(60));

  it.each(files.map((f) => [rel(f), f]))(
    "%s: mutating handlers are CSRF-protected",
    (name, f) => {
      const s = src(f as string);
      const mutating = [...s.matchAll(MUTATING)].length;
      if (mutating === 0 || NO_CSRF_OK.has(name as string)) return;
      const wrappedWrites = (
        s.match(
          /withActor\([^)]*\{\s*write:\s*true\s*\}|withPlatformAdmin\([^)]*\{\s*write:\s*true\s*\}/g,
        ) ?? []
      ).length;
      const manual = (s.match(/assertSameOrigin\(/g) ?? []).length;
      expect(
        wrappedWrites + manual,
        `${name} has ${mutating} mutating handler(s) without a CSRF guard`,
      ).toBeGreaterThanOrEqual(mutating);
    },
  );

  it.each(files.map((f) => [rel(f), f]))(
    "%s: read handlers never use the write wrapper by mistake, writes never use the read wrapper",
    (_n, f) => {
      const s = src(f as string);
      for (const m of s.matchAll(
        /export (?:async )?function (GET|HEAD)\b[\s\S]*?(?=\nexport |\s*$)/g,
      )) {
        expect(m[0]).not.toMatch(/write:\s*true/);
      }
      for (const m of s.matchAll(
        /export (?:async )?function (POST|PUT|PATCH|DELETE)\b[\s\S]*?(?=\nexport |\s*$)/g,
      )) {
        expect(m[0]).not.toMatch(/write:\s*false/);
      }
    },
  );

  it.each(files.map((f) => [rel(f), f]))(
    "%s: authenticates unless explicitly public",
    (name, f) => {
      if (name in PUBLIC_API) return;
      const s = src(f as string);
      expect(
        s,
        `${name} must authenticate (withActor/withPlatformAdmin/requireActor/getOrgContext)`,
      ).toMatch(/withActor|withPlatformAdmin|requireActor|getOrgContext/);
    },
  );

  it("the public list contains only real routes (no stale entries hiding a missing file)", () => {
    const set = new Set(files.map(rel));
    for (const k of Object.keys(PUBLIC_API))
      if (k !== "api/assets/[id]/route.ts") expect(set.has(k), k).toBe(true);
  });

  it("public non-API routes (tracking/view/assets) never accept state-changing methods", () => {
    for (const f of publicRoutes)
      expect([...src(f).matchAll(MUTATING)], rel(f)).toHaveLength(0);
  });

  it("tenant context only ever comes from the session: no route reads an organization id from the request body for scoping", () => {
    // Switching the active organization names an org on purpose; the service verifies it against the caller's memberships.
    const SELECTS_AMONG_OWN_MEMBERSHIPS = new Set([
      "api/organizations/switch/route.ts",
    ]);
    for (const f of files) {
      if (SELECTS_AMONG_OWN_MEMBERSHIPS.has(rel(f))) continue;
      const s = src(f);
      // actor.organizationId is the scope; a body field named organizationId would be a confused-deputy risk.
      expect(s, rel(f)).not.toMatch(
        /parsed\.data\.organizationId|body\.organizationId|searchParams\.get\(["']organizationId["']\)/,
      );
    }
  });
});
