import "server-only";
import { getDb } from "../db";

export const devDeps = () => ({
  db: getDb().db,
  allowInsecureWebhooks: process.env.NODE_ENV !== "production",
});
