import "server-only";
import { getRedis } from "./redis";

/**
 * Fixed-window counter in Redis. Fails open if Redis is unreachable — a broken
 * limiter must not take authentication down — but logs loudly so it is noticed.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  try {
    const redis = getRedis();
    const redisKey = `rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds);
    return { allowed: count <= limit };
  } catch (error) {
    console.error("[rate-limit] Redis unavailable, failing open", error);
    return { allowed: true };
  }
}
