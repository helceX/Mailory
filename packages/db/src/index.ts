import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof createDb>["db"];

/**
 * ADR-001 (docs/MAILORY_ARCHITECTURE.md §3): every tenant-scoped repository
 * takes `OrganizationId` as a required argument; a raw string cannot be passed
 * where a session-derived tenant id is expected.
 */
export type OrganizationId = string & { readonly __brand: "OrganizationId" };
export function asOrganizationId(id: string): OrganizationId {
  return id as OrganizationId;
}

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Readiness probe: resolves true only if a trivial query succeeds quickly. */
export async function checkDb(pool: Pool, timeoutMs = 2000): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("db check timeout")), timeoutMs).unref(),
  );
  try {
    await Promise.race([pool.query("select 1"), timeout]);
    return true;
  } catch {
    return false;
  }
}

export * from "./schema/index";
export * from "./repositories/auth";
export * from "./repositories/organizations";
export * from "./repositories/audit";
export * from "./repositories/contacts";
export * from "./repositories/audience";
export * from "./segments";
export * from "./repositories/templates";
export * from "./repositories/senders";
export * from "./repositories/campaigns";
export * from "./repositories/sending";
export * from "./repositories/tracking";
export * from "./repositories/deliverability";
export * from "./repositories/automations";
