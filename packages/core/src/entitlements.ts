/** Plan limits (entitlements). Pure definitions shared by the server (enforcement) and the UI (labels). */
export const ENTITLEMENT_KEYS = [
  "contacts",
  "emails_per_month",
  "members",
  "automations",
  "ai_credits",
  "storage_mb",
  "api_requests",
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const ENTITLEMENT_LABELS: Record<
  EntitlementKey,
  { label: string; unit: string; period: "total" | "month" }
> = {
  contacts: { label: "Kişi", unit: "kişi", period: "total" },
  emails_per_month: { label: "Aylık e-posta", unit: "e-posta", period: "month" },
  members: { label: "Ekip üyesi", unit: "üye", period: "total" },
  automations: { label: "Etkin otomasyon", unit: "otomasyon", period: "total" },
  ai_credits: { label: "Yapay zekâ isteği", unit: "istek", period: "month" },
  storage_mb: { label: "Görsel depolama", unit: "MB", period: "total" },
  api_requests: { label: "API isteği", unit: "istek", period: "month" },
};

export const PLAN_KEYS = [
  "free",
  "starter",
  "growth",
  "pro",
  "enterprise",
  "btm_sponsored",
] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const PLAN_LABELS: Record<PlanKey, string> = {
  free: "Ücretsiz",
  starter: "Başlangıç",
  growth: "Büyüme",
  pro: "Pro",
  enterprise: "Kurumsal",
  btm_sponsored: "Sponsorlu",
};
export const DEFAULT_PLAN: PlanKey = "free";

export const SUBSCRIPTION_SOURCES = ["manual", "sponsored", "stripe"] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

/** null = unlimited. */
export type Limit = number | null;

export type Check = {
  key: EntitlementKey;
  allowed: boolean;
  limit: Limit;
  used: number;
  /** How many more can be added right now (null = unlimited). */
  remaining: number | null;
};

/** Pure decision: would `used + delta` stay within `limit`? Unlimited always passes; delta ≤ 0 (freeing) always passes. */
export function decide(
  key: EntitlementKey,
  limit: Limit,
  used: number,
  delta = 1,
): Check {
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const allowed = delta <= 0 || limit === null || used + delta <= limit;
  return { key, allowed, limit, used, remaining };
}

export function limitMessage(c: Check): string {
  const e = ENTITLEMENT_LABELS[c.key];
  return c.limit === null
    ? ""
    : `Planınızın ${e.label.toLowerCase()} sınırına ulaştınız (${c.used.toLocaleString("tr-TR")} / ${c.limit.toLocaleString("tr-TR")} ${e.unit}). Sınırı artırmak için yöneticinizle iletişime geçin.`;
}

/** First UTC instant of the month containing `now` (usage periods are UTC calendar months). */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
