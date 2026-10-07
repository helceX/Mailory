import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const folder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);
const { db, pool } = createDb(url);
try {
  if (!existsSync(path.join(folder, "meta", "_journal.json"))) {
    console.log("[migrate] no migrations yet — nothing to apply");
  } else {
    await migrate(db, { migrationsFolder: folder });
    console.log("[migrate] done");
  }
} finally {
  await pool.end();
}
