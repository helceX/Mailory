import "server-only";
import { getEnv } from "@mailory/config";
import { createDnsResolver, createDomainProvider } from "@mailory/deliverability";
import { getDb } from "../db";
import type { SenderDeps } from "./service";

export function senderDeps(): SenderDeps {
  const env = getEnv();
  const resolver = createDnsResolver(env);
  return {
    db: getDb().db,
    resolver,
    provider: createDomainProvider(env, resolver),
    platformHost: new URL(env.APP_URL).hostname,
  };
}
