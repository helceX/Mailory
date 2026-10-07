import { CSV_BOM, reviewRates, toCsvLine, type Permission } from "@mailory/core";
import {
  campaignStats,
  compareCampaigns,
  engagementTimeline,
  getCampaign,
  orgOverview,
  recordAudit,
  topLinks,
  type CampaignStats,
  type Database,
} from "@mailory/db";
import { authorize, type Actor } from "../org/service";

export type AnalyticsDeps = { db: Database; now?: () => Date };
type Failure = {
  ok: false;
  code: "forbidden" | "not_found" | "invalid";
  message?: string;
};
const denied: Failure = { ok: false, code: "forbidden" };
const need = (actor: Actor, p: Permission) => authorize(actor, p);

/** n/d as a fraction, or null when there is nothing to divide by (shown as "—", never as 0%). */
export const rate = (n: number, d: number) => (d > 0 ? n / d : null);

export function rates(s: CampaignStats) {
  return {
    delivery: rate(s.delivered, s.sent),
    open: rate(s.uniqueOpens, s.delivered || s.sent),
    click: rate(s.uniqueClicks, s.delivered || s.sent),
    clickToOpen: rate(s.uniqueClicks, s.uniqueOpens),
    bounce: rate(s.bounced, s.sent),
    complaint: rate(s.complained, s.sent),
    unsubscribe: rate(s.unsubscribed, s.sent),
  };
}

export async function getCampaignReport(deps: AnalyticsDeps, actor: Actor, id: string) {
  if (!need(actor, "analytics:read")) return denied;
  const org = actor.organizationId;
  const campaign = await getCampaign(deps.db, org, id);
  if (!campaign) return { ok: false, code: "not_found" } as Failure;
  const [stats, links, timeline] = await Promise.all([
    campaignStats(deps.db, org, id),
    topLinks(deps.db, org, id),
    engagementTimeline(deps.db, org, id),
  ]);
  return {
    ok: true as const,
    stats,
    rates: rates(stats),
    links,
    timeline,
    findings: reviewRates(stats),
  };
}

export async function getAnalyticsOverview(
  deps: AnalyticsDeps,
  actor: Actor,
  days = 30,
) {
  if (!need(actor, "analytics:read")) return denied;
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - days * 86_400_000);
  const [overview, campaigns] = await Promise.all([
    orgOverview(deps.db, actor.organizationId, since),
    compareCampaigns(deps.db, actor.organizationId),
  ]);
  return {
    ok: true as const,
    days,
    overview,
    overviewRates: rates(overview),
    campaigns: campaigns.map((c) => ({ ...c, rates: rates(c) })),
  };
}

const pctCell = (v: number | null) =>
  v === null ? "" : (v * 100).toFixed(1).replace(".", ",");

/** Campaign comparison as CSV (Excel-friendly: BOM, semicolon-safe quoting, formula-injection escaping). Audited. */
export async function exportAnalyticsCsv(deps: AnalyticsDeps, actor: Actor) {
  if (!need(actor, "analytics:read")) return denied;
  const campaigns = await compareCampaigns(deps.db, actor.organizationId, 500);
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "analytics.exported",
    entityType: "campaign",
    entityId: null,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { rows: campaigns.length },
  });
  const lines = [
    CSV_BOM +
      toCsvLine([
        "Kampanya",
        "Konu",
        "Durum",
        "Başlangıç",
        "Alıcı",
        "Gönderilen",
        "Teslim edilen",
        "Benzersiz açılma",
        "Açılma %",
        "Benzersiz tıklama",
        "Tıklama %",
        "Geri dönen",
        "Geri dönme %",
        "Şikayet",
        "Abonelikten çıkan",
      ]),
    ...campaigns.map((c) => {
      const r = rates(c);
      return toCsvLine([
        c.name,
        c.subject,
        c.status,
        c.startedAt?.toISOString() ?? "",
        c.recipients,
        c.sent,
        c.delivered,
        c.uniqueOpens,
        pctCell(r.open),
        c.uniqueClicks,
        pctCell(r.click),
        c.bounced,
        pctCell(r.bounce),
        c.complained,
        c.unsubscribed,
      ]);
    }),
  ];
  return { ok: true as const, rows: campaigns.length, csv: lines.join("") };
}
