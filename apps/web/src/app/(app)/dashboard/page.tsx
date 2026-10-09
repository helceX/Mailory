import Link from "next/link";
import { Mail } from "lucide-react";
import { can } from "@mailory/core";
import { Button, EmptyState } from "@mailory/ui";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import {
  AttentionList,
  QuickActions,
  RecentCampaigns,
  UsagePanel,
} from "@/components/dashboard/dashboard-sections";
import { getOrgContext } from "@/lib/org/context";
import { getDb } from "@/lib/db";
import { Kpi, KpiGrid, fmtNum, fmtPct } from "@/components/analytics/kpi";
import { getAnalyticsOverview } from "@/lib/analytics/service";
import { getPlanOverview } from "@/lib/billing/service";
import { campaignDeps } from "@/lib/campaigns/deps";
import { listCampaignsFor } from "@/lib/campaigns/service";
import { getDeliverabilityCenter } from "@/lib/deliverability/service";
import { getOnboarding } from "@/lib/senders/service";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = (await getOrgContext())!;
  const actor = context.actor!;
  const deps = { db: getDb().db };
  const [onboarding, analytics, plan, center, campaigns] = await Promise.all([
    getOnboarding(deps, actor),
    getAnalyticsOverview(deps, actor, 30),
    getPlanOverview(deps, actor),
    getDeliverabilityCenter(deps, actor),
    listCampaignsFor(campaignDeps(), actor),
  ]);
  const hasData = analytics.ok && analytics.overview.campaigns > 0;
  const recent = campaigns.ok
    ? campaigns.campaigns.slice(0, 5).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status as never,
        scheduledAt: c.scheduledAt?.toISOString() ?? null,
        updatedAt: c.updatedAt.toISOString(),
      }))
    : [];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Hoş geldiniz{context.user.firstName ? `, ${context.user.firstName}` : ""}.
          </p>
        </div>
        <QuickActions canWrite={can(actor.role, "campaigns:write")} />
      </div>
      {onboarding.finished ? null : (
        <OnboardingChecklist
          steps={onboarding.steps}
          completed={onboarding.completed}
          total={onboarding.total}
        />
      )}
      {center.ok ? <AttentionList alerts={center.actions} /> : null}
      {analytics.ok && hasData ? (
        <section aria-labelledby="perf" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="perf" className="text-lg font-semibold">
              Son 30 gün
            </h2>
            <Link href="/analytics" className="text-sm text-primary hover:underline">
              Ayrıntılı analitik
            </Link>
          </div>
          <KpiGrid>
            <Kpi
              label="Gönderilen"
              value={fmtNum(analytics.overview.sent)}
              sub={`${analytics.overview.campaigns} kampanya`}
            />
            <Kpi
              label="Teslim oranı"
              value={fmtPct(analytics.overviewRates.delivery)}
            />
            <Kpi
              label="Açılma (tahmini)"
              value={fmtPct(analytics.overviewRates.open)}
            />
            <Kpi label="Tıklama" value={fmtPct(analytics.overviewRates.click)} />
          </KpiGrid>
        </section>
      ) : (
        <EmptyState
          icon={<Mail className="size-6" aria-hidden="true" />}
          title="Henüz kampanyanız bulunmuyor."
          description="İlk kampanyanızı oluşturduğunuzda performansınız burada görünür."
          action={
            <Button asChild variant="secondary">
              <Link href="/templates?tab=library">Şablonlara göz at</Link>
            </Button>
          }
        />
      )}
      <RecentCampaigns rows={recent} />
      {plan.ok ? <UsagePanel planName={plan.planName} rows={plan.rows} /> : null}
    </div>
  );
}
