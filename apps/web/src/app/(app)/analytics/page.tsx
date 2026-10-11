import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { CAMPAIGN_STATUS_LABELS, isCampaignStatus } from "@mailory/core";
import {
  Button,
  EmptyState,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@mailory/ui";
import { Kpi, KpiGrid, fmtNum, fmtPct } from "@/components/analytics/kpi";
import { PageHeader } from "@/components/page-header";
import { getAnalyticsOverview } from "@/lib/analytics/service";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Analitik" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const actor = (await getOrgContext())!.actor!;
  const result = await getAnalyticsOverview({ db: getDb().db }, actor, 30);
  if (!result.ok)
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Analitik" />
        <p className="mt-4 text-sm text-muted-foreground">
          Bu sayfayı görüntüleme yetkiniz yok.
        </p>
      </div>
    );
  const { overview: o, overviewRates: r } = result;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Analitik"
        description="Son 30 günde başlayan kampanyaların toplam performansı."
        actions={
          result.campaigns.length > 0 ? (
            <Button asChild variant="secondary">
              <a href="/api/analytics/export" download>
                <Download className="size-4" aria-hidden="true" /> CSV indir
              </a>
            </Button>
          ) : null
        }
      />
      {result.campaigns.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="size-6" aria-hidden="true" />}
          title="Henüz gönderilmiş kampanya yok."
          description="İlk kampanyanız gönderilmeye başladığında teslim, açılma ve tıklama oranları burada görünür."
          action={
            <Button asChild variant="secondary">
              <Link href="/campaigns">Kampanyalara git</Link>
            </Button>
          }
        />
      ) : (
        <>
          <KpiGrid>
            <Kpi label="Kampanya" value={fmtNum(o.campaigns)} />
            <Kpi label="Gönderilen" value={fmtNum(o.sent)} />
            <Kpi label="Teslim oranı" value={fmtPct(r.delivery)} />
            <Kpi
              label="Açılma (tahmini)"
              value={fmtPct(r.open)}
              hint="Apple Mail Gizlilik Koruması gibi özellikler açılmaları olduğundan yüksek gösterebilir."
            />
            <Kpi label="Tıklama" value={fmtPct(r.click)} />
            <Kpi label="Geri dönen" value={fmtPct(r.bounce)} />
            <Kpi label="Şikayet" value={fmtPct(r.complaint)} />
            <Kpi label="Abonelikten çıkan" value={fmtPct(r.unsubscribe)} />
          </KpiGrid>
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Kampanya</TH>
                  <TH>Durum</TH>
                  <TH>Gönderilen</TH>
                  <TH>Teslim</TH>
                  <TH>Açılma</TH>
                  <TH>Tıklama</TH>
                  <TH>Geri dönen</TH>
                  <TH>Çıkan</TH>
                </tr>
              </THead>
              <TBody>
                {result.campaigns.map((c) => (
                  <tr key={c.id}>
                    <TD>
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {c.startedAt?.toLocaleDateString("tr-TR")}
                      </div>
                    </TD>
                    <TD>
                      {isCampaignStatus(c.status)
                        ? CAMPAIGN_STATUS_LABELS[c.status]
                        : c.status}
                    </TD>
                    <TD>{fmtNum(c.sent)}</TD>
                    <TD>{fmtPct(c.rates.delivery)}</TD>
                    <TD>{fmtPct(c.rates.open)}</TD>
                    <TD>{fmtPct(c.rates.click)}</TD>
                    <TD>{fmtPct(c.rates.bounce)}</TD>
                    <TD>{fmtPct(c.rates.unsubscribe)}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </>
      )}
    </div>
  );
}
