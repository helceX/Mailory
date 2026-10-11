/**
 * Bulk-imports the ready-made template packs (templates/packs) into one organization through the normal importer.
 *
 *   DATABASE_URL=… pnpm templates:import --org <organization-uuid> [--dry-run] [--only slug[,slug…]] [--packs dir]
 *
 * - The connection string comes only from DATABASE_URL (never from code or flags).
 * - Idempotent: a live template with the same name is skipped, so re-running is safe.
 * - `--dry-run` reads the database (existing names, asset usage) but writes nothing.
 * - The organization's owner is the importing user; every import is audited as `template.imported`.
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createDb } from "../packages/db/src/index";
import { EXPECTED_WARNING, importPacks } from "../apps/web/src/lib/templates/packs";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    only: { type: "string", multiple: true },
    packs: { type: "string", default: "templates/packs" },
  },
});

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (environment variable).");
  const org = values.org ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org))
    throw new Error("--org <organization uuid> is required.");
  const only = (values.only ?? []).flatMap((v) => v.split(",")).filter(Boolean);
  const dryRun = values["dry-run"] === true;

  const { db, pool } = createDb(url);
  try {
    const results = await importPacks({
      deps: { db, appUrl: (process.env.APP_URL ?? "").replace(/\/$/, "") },
      organizationId: org,
      packsDir: resolve(values.packs!),
      only,
      dryRun,
      log: (line) => console.log(line),
    });

    const count = (s: string) => results.filter((r) => r.status === s).length;
    const odd = results.filter(
      (r) =>
        r.status === "imported" && r.warnings.some((w) => !EXPECTED_WARNING.test(w)),
    );
    console.log(
      `\n${dryRun ? "[dry-run] " : ""}${results.length} packs: ` +
        `${count("imported") + count("would_import")} ${dryRun ? "would import" : "imported"}, ` +
        `${count("skipped_exists")} already existed, ${count("failed")} failed, ${count("stopped")} not attempted (image capacity)`,
    );
    for (const r of odd)
      console.log(`warnings  ${r.slug}:\n  - ${r.warnings.join("\n  - ")}`);
    for (const r of results.filter(
      (x) => x.status === "failed" || x.status === "stopped",
    ))
      console.log(`${r.status.toUpperCase()}  ${r.slug}: ${r.detail}`);
    process.exitCode = count("failed") + count("stopped") > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
