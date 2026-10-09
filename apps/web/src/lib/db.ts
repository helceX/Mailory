import "server-only";
import { createDb } from "@mailory/db";
import { getEnv } from "@mailory/config";

// One pool per server process (survives Next dev HMR via globalThis).
const globalForDb = globalThis as unknown as {
  __mailoryDb?: ReturnType<typeof createDb>;
};

export function getDb() {
  globalForDb.__mailoryDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__mailoryDb;
}
