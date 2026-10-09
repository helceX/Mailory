import { Badge } from "@mailory/ui";
import { Kpi, KpiGrid, fmtNum } from "@/components/analytics/kpi";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/platform/admin-forms";
import { orgDeps } from "@/lib/org/context";
import { requirePlatformAdmin } from "@/lib/platform/page-guard";
import { getSystemStatus } from "@/lib/platform/service";
import { getRedis } from "@/lib/redis";

export const metadata = { title: "Sistem durumu" };
export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const admin = await requirePlatformAdmin();
  const r = await getSystemStatus(orgDeps(), admin, () =>
    getRedis().get("mailory:worker:heartbeat"),
  );
  if (!r.ok) return null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <BackLink href="/platform">Platform</BackLink>
      <PageHeader
        title="Sistem durumu"
        description="İşçi süreci, gönderim kuyruğu ve genel sayılar."
        actions={
          r.worker.alive ? (
            <Badge tone="success">İşçi çalışıyor</Badge>
          ) : (
            <Badge tone="danger">İşçi yanıt vermiyor</Badge>
          )
        }
      />
      <KpiGrid>
        <Kpi
          label="İşçi son sinyal"
          value={r.worker.ageSeconds === null ? "—" : `${r.worker.ageSeconds} sn önce`}
        />
        <Kpi label="Gönderilen kampanya" value={fmtNum(r.counts.sending)} />
        <Kpi label="Kuyrukta alıcı" value={fmtNum(r.counts.queued)} />
        <Kpi label="Son 24s başarısız" value={fmtNum(r.counts.failed24h)} />
        <Kpi
          label="Gönderilemeyen sistem e-postası"
          value={fmtNum(r.counts.outboxFailed)}
        />
        <Kpi label="Etkin otomasyon" value={fmtNum(r.counts.activeAutomations)} />
        <Kpi label="Askıdaki çalışma alanı" value={fmtNum(r.counts.suspended)} />
        <Kpi label="Toplam çalışma alanı" value={fmtNum(r.counts.orgs)} />
      </KpiGrid>
    </div>
  );
}
