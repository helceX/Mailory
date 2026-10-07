import Link from "next/link";
import { HEALTH_BAND_LABELS } from "@mailory/core";
import { Badge, Table, TableContainer, TBody, TD, TH, THead } from "@mailory/ui";
import { Kpi, KpiGrid, fmtNum, fmtPct } from "@/components/analytics/kpi";
import { BAND_TONE } from "@/components/deliverability/health-panel";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/lib/db";
import { getDeliverabilityCenter } from "@/lib/deliverability/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Teslim edilebilirlik" };
export const dynamic = "force-dynamic";

const SEV = {
  critical: ["Kritik", "danger"],
  warning: ["Uyarı", "warning"],
  info: ["Bilgi", "neutral"],
} as const;
const stateLabel = (s: string | null) =>
  s === "ok" ? "Tamam" : s === "mismatch" ? "Hatalı" : "Eksik";

export default async function DeliverabilityPage() {
  const actor = (await getOrgContext())!.actor!;
  const r = await getDeliverabilityCenter({ db: getDb().db }, actor);
  if (!r.ok)
    return (
      <p className="text-sm text-muted-foreground">
        Bu sayfayı görüntüleme yetkiniz yok.
      </p>
    );
  const sent = r.rolling.sent;
  const ratio = (n: number) => (sent >= 1 ? n / sent : null);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Teslim edilebilirlik"
        description="Göndericinizin sağlığı, listenizin kalitesi ve yapmanız gerekenler."
        actions={
          <Badge tone={BAND_TONE[r.band]}>
            {HEALTH_BAND_LABELS[r.band]} · {r.score}/100
          </Badge>
        }
      />

      <section aria-labelledby="todo" className="flex flex-col gap-3">
        <h2 id="todo" className="text-lg font-semibold">
          Yapılacaklar
        </h2>
        {r.actions.length === 0 ? (
          <p className="rounded-lg border bg-surface p-4 text-sm text-success">
            Şu an yapmanız gereken bir şey yok. Her şey yolunda görünüyor.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {r.actions.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border bg-surface p-3 text-sm"
              >
                <Badge tone={SEV[a.severity][1]}>{SEV[a.severity][0]}</Badge>
                <div className="min-w-[240px] flex-1">
                  <div>{a.message}</div>
                  <div className="text-xs text-muted-foreground">{a.fix}</div>
                </div>
                {a.href ? (
                  <Link href={a.href} className="text-primary hover:underline">
                    Git
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rep" className="flex flex-col gap-3">
        <h2 id="rep" className="text-lg font-semibold">
          Son 30 gün
        </h2>
        <KpiGrid>
          <Kpi label="Gönderilen" value={fmtNum(sent)} />
          <Kpi
            label="Geri dönme"
            value={fmtPct(ratio(r.rolling.bounced))}
            sub={`Hedef < %${r.thresholds.bounceWarn * 100}`}
          />
          <Kpi
            label="Şikayet"
            value={fmtPct(ratio(r.rolling.complained))}
            sub={`Hedef < %${r.thresholds.complaintWarn * 100}`}
          />
          <Kpi
            label="Abonelikten çıkma"
            value={fmtPct(ratio(r.rolling.unsubscribed))}
          />
        </KpiGrid>
        <p className="text-xs text-muted-foreground">
          Günlük sınır: {fmtNum(r.limits.sentToday)} / {fmtNum(r.limits.daily)}{" "}
          gönderildi (UTC gün başında sıfırlanır).
        </p>
      </section>

      <section aria-labelledby="dom" className="flex flex-col gap-3">
        <h2 id="dom" className="text-lg font-semibold">
          Alan adı kimlik doğrulaması
        </h2>
        {r.domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Alan adı yok.{" "}
            <Link href="/settings/domains" className="text-primary hover:underline">
              Ekleyin
            </Link>
            .
          </p>
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Alan adı</TH>
                  <TH>Durum</TH>
                  <TH>DKIM</TH>
                  <TH>SPF</TH>
                  <TH>DMARC</TH>
                </tr>
              </THead>
              <TBody>
                {r.domains.map((d) => (
                  <tr key={d.id}>
                    <TD>
                      <Link
                        href={`/settings/domains/${d.id}`}
                        className="text-primary hover:underline"
                      >
                        {d.domain}
                      </Link>
                    </TD>
                    <TD>
                      {d.status === "verified"
                        ? "Doğrulandı"
                        : d.status === "failed"
                          ? "Başarısız"
                          : "Bekliyor"}
                    </TD>
                    <TD>{d.dkimOk ? "Tamam" : "Eksik"}</TD>
                    <TD>{stateLabel(d.spfState)}</TD>
                    <TD>{stateLabel(d.dmarcState)}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </section>

      <section aria-labelledby="list" className="flex flex-col gap-3">
        <h2 id="list" className="text-lg font-semibold">
          Liste kalitesi
        </h2>
        <KpiGrid>
          <Kpi
            label="Aktif abone"
            value={fmtNum(r.lists.subscribed)}
            sub={`${fmtNum(r.lists.total)} kişiden`}
          />
          <Kpi
            label="Çok aktif / aktif"
            value={`${fmtNum(r.lists.hot)} / ${fmtNum(r.lists.warm)}`}
          />
          <Kpi
            label="Soğuk / pasif"
            value={`${fmtNum(r.lists.cold)} / ${fmtNum(r.lists.dormant)}`}
          />
          <Kpi
            label="Henüz skorlanmamış"
            value={fmtNum(r.lists.unscored)}
            hint="Son 90 günde en az 3 e-posta almayan kişiler skorlanmaz."
          />
        </KpiGrid>
      </section>
    </div>
  );
}
