import Link from "next/link";
import { Mail } from "lucide-react";
import { Button, EmptyState } from "@mailory/ui";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { getOrgContext } from "@/lib/org/context";
import { getDb } from "@/lib/db";
import { Kpi, KpiGrid, fmtNum, fmtPct } from "@/components/analytics/kpi";
import { getAnalyticsOverview } from "@/lib/analytics/service";
import { getOnboarding } from "@/lib/senders/service";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = (await getOrgContext())!.actor!;
  const onboarding = await getOnboarding({ db: getDb().db }, actor);
  const analytics = await getAnalyticsOverview({ db: getDb().db }, actor, 30);
  const hasData = analytics.ok && analytics.overview.campaigns > 0;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
      {onboarding.finished ? null : (
        <OnboardingChecklist
          steps={onboarding.steps}
          completed={onboarding.completed}
          total={onboarding.total}
        />
      )}
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
    </div>
  );
}
