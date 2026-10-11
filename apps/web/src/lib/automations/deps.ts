import "server-only";
import { getEnv } from "@mailory/config";
import { getDb } from "../db";

export const automationDeps = () => ({
  db: getDb().db,
  appUrl: getEnv().APP_URL.replace(/\/$/, ""),
});
