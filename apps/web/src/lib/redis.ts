import "server-only";
import { Redis } from "ioredis";
import { getEnv } from "@mailory/config";

const globalForRedis = globalThis as unknown as { __mailoryRedis?: Redis };

export function getRedis(): Redis {
  globalForRedis.__mailoryRedis ??= new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    enableOfflineQueue: false,
  });
  return globalForRedis.__mailoryRedis;
}
