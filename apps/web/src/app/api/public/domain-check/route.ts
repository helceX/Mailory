import { NextResponse } from "next/server";
import { getEnv } from "@mailory/config";
import { normalizeDomain } from "@mailory/core";
import { createDnsResolver } from "@mailory/deliverability";
import { checkDomainHealth } from "@mailory/email";
import { apiError, clientIp, limit } from "@/lib/api";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const CACHE_SECONDS = 600;

/**
 * Public, read-only, unauthenticated: the free "alan adı sağlık raporu". It only performs public DNS lookups for a
 * syntactically valid hostname (no IPs, no single labels), is rate-limited per client and cached per domain, and
 * returns nothing but what anyone can already see in DNS.
 */
export async function GET(request: Request) {
  const limited = await limit(
    `domaincheck:${clientIp(request) ?? "unknown"}`,
    10,
    3600,
  );
  if (limited) return limited;
  const raw = new URL(request.url).searchParams.get("domain") ?? "";
  const domain = normalizeDomain(raw.slice(0, 300));
  if (!domain)
    return apiError(
      400,
      "invalid_domain",
      "Geçerli bir alan adı girin (örn. sirketim.com).",
    );

  const key = `dc:${domain}`;
  try {
    const cached = await getRedis().get(key);
    if (cached) return NextResponse.json({ ...JSON.parse(cached), cached: true });
  } catch {
    /* cache is an optimization only */
  }
  const result = await checkDomainHealth(createDnsResolver(getEnv()), domain);
  try {
    await getRedis().set(key, JSON.stringify(result), "EX", CACHE_SECONDS);
  } catch {
    /* ignore */
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
