import "server-only";
import { getEnv } from "@mailory/config";
import { getDb } from "./db";

export function sendingDeps() {
  const env = getEnv();
  return { db: getDb().db, secret: env.SESSION_SECRET };
}
