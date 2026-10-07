import { eq, sql } from "drizzle-orm";
import { createDb } from "./index";
import { users } from "./schema/index";

/**
 * Grants or revokes platform-admin rights. Deliberately a CLI and not an API: the first admin is made by someone who
 * already controls the database, and nothing in the web app can mint one.
 *
 *   pnpm --filter @mailory/db platform-admin you@example.com           # grant
 *   pnpm --filter @mailory/db platform-admin you@example.com --revoke  # revoke
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes("--revoke");
if (!email || email.startsWith("--")) {
  console.error("usage: platform-admin <email> [--revoke]");
  process.exit(2);
}
const { db, pool } = createDb(url);
try {
  const rows = await db
    .update(users)
    .set({ isPlatformAdmin: !revoke, updatedAt: new Date() })
    .where(eq(sql`lower(${users.email})`, email))
    .returning({ id: users.id });
  if (rows.length === 0) {
    console.error(
      `[platform-admin] no user with email ${email} (they must register first)`,
    );
    process.exit(1);
  }
  console.log(
    `[platform-admin] ${email}: platform admin ${revoke ? "revoked" : "granted"}`,
  );
} finally {
  await pool.end();
}
