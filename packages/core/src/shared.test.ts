import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Follows relative imports from shared.ts and fails if any reachable file touches a Node built-in. */
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(path.join(dir, entry), "utf8");
  for (const m of source.matchAll(/from\s+"\.\/([\w-]+)"/g))
    reachable(`${m[1]}.ts`, seen);
  return seen;
}

describe("@mailory/core/shared (browser-safe boundary)", () => {
  const files = reachable("shared.ts");
  it("covers the modules client components rely on", () => {
    expect([...files]).toEqual(
      expect.arrayContaining([
        "authz.ts",
        "segment-fields.ts",
        "csv.ts",
        "custom-fields.ts",
      ]),
    );
  });
  it("never reaches password, tokens or same-origin", () => {
    for (const forbidden of ["password.ts", "tokens.ts", "same-origin.ts"])
      expect(files.has(forbidden)).toBe(false);
  });
  it("imports no Node built-ins anywhere it reaches", () => {
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(
        /from\s+"node:|require\(["']node:|from\s+"(crypto|fs|path|buffer)"/,
      );
    }
  });
  it("main entry stays a superset of shared", () => {
    const index = readFileSync(path.join(dir, "index.ts"), "utf8");
    expect(index).toContain('export * from "./shared"');
    expect(readdirSync(dir)).toContain("password.ts");
  });
});
