import "server-only";
import { createAiProvider, type AiProvider } from "@mailory/ai";
import { getEnv } from "@mailory/config";
import { getDb } from "../db";
import type { AiDeps } from "./service";

let provider: AiProvider | null | undefined;
export function aiDeps(): AiDeps {
  const env = getEnv();
  provider ??= createAiProvider(env);
  return {
    db: getDb().db,
    appUrl: env.APP_URL.replace(/\/$/, ""),
    provider,
    dailyLimit: env.AI_DAILY_LIMIT_PER_ORG,
  };
}
