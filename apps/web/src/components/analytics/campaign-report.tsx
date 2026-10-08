import type { Finding } from "@mailory/core/shared";
import type { CampaignStats, ConversionStats } from "@mailory/db";
import { HealthPanel } from "../deliverability/health-panel";
import { Table, TableContainer, TBody, TD, TH, THead } from "@mailory/ui";
import { Kpi, KpiGrid, fmtNum, fmtPct } from "./kpi";

type Rates = Record<
  | "delivery"
  | "open"
  | "click"
  | "clickToOpen"
  | "bounce"
  | "complaint"
  | "unsubscribe",
  number | null
>;

export function CampaignReport({
  stats,
  rates,
  links,
  timeline,
  findings = [],
  outcomes,
}: {
  stats: CampaignStats;
  rates: Rates;
  links: { url: string; clicks: number; uniqueClicks: number }[];
  timeline: { bucket: Date; opens: number; clicks: number }[];
  findings?: Finding[];
  outcomes?: ConversionStats;
}) {
  return (
    <section aria-labelledby="report" className="flex flex-col gap-4">
      <h2 id="report" className="text-lg font-semibold">
        Performans
      </h2>
      <KpiGrid>
        <Kpi
          label="Gönderilen"
          value={fmtNum(stats.sent)}
          sub={`${fmtNum(stats.recipients)} alıcıdan`}
        />
        <Kpi
          label="Teslim oranı"
          value={fmtPct(rates.delivery)}
          sub={`${fmtNum(stats.delivered)} teslim`}
        />
        <Kpi
          label="Açılma (tahmini)"
          value={fmtPct(rates.open)}
          sub={`${fmtNum(stats.uniqueOpens)} kişi · ${fmtNum(stats.totalOpens)} toplam`}
          hint="Bazı e-posta uygulamaları (ör. Apple Mail Gizlilik Koruması) görselleri otomatik yükler; açılma oranı gerçekte olduğundan yüksek görünebilir. Tıklama daha güvenilir bir ölçüdür."
        />
        <Kpi
          label="Tıklama"
          value={fmtPct(rates.click)}
          sub={`${fmtNum(stats.uniqueClicks)} kişi · ${fmtNum(stats.totalClicks)} toplam`}
        />
        <Kpi
          label="Geri dönen"
          value={fmtPct(rates.bounce)}
          sub={`${fmtNum(stats.bounced)} adres`}
        />
        <Kpi
          label="Şikayet"
          value={fmtPct(rates.complaint)}
          sub={`${fmtNum(stats.complained)} kişi`}
        />
        <Kpi
          label="Abonelikten çıkan"
          value={fmtPct(rates.unsubscribe)}
          sub={`${fmtNum(stats.unsubscribed)} kişi`}
        />
        <Kpi label="Açanlar içinde tıklayan" value={fmtPct(rates.clickToOpen)} />
      </KpiGrid>
      {outcomes ? <Outcomes outcomes={outcomes} stats={stats} /> : null}
      <p className="text-xs text-muted-foreground">
        Botlar, güvenlik tarayıcıları ve gönderimden hemen sonraki otomatik tıklamalar
        sayılmaz. IP adresi ve cihaz bilgisi ham haliyle saklanmaz.
      </p>

      {findings.length > 0 ? (
        <HealthPanel
          score={Math.max(0, 100 - findings.length * 15)}
          band={findings.some((f) => f.severity === "critical") ? "risky" : "attention"}
          findings={findings}
        />
      ) : null}
      <Timeline points={timeline} />

      <div>
        <h3 className="mb-2 text-sm font-semibold">En çok tıklanan bağlantılar</h3>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz tıklama yok.</p>
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Bağlantı</TH>
                  <TH>Benzersiz</TH>
                  <TH>Toplam</TH>
                </tr>
              </THead>
              <TBody>
                {links.map((l) => (
                  <tr key={l.url}>
                    <TD className="max-w-md truncate" title={l.url}>
                      {l.url}
                    </TD>
                    <TD>{fmtNum(l.uniqueClicks)}</TD>
                    <TD>{fmtNum(l.clicks)}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </div>
    </section>
  );
}

/** Hourly opens (bars) and clicks (line of dots) as accessible SVG, with the same data in a collapsible table. */
function Timeline({
  points,
}: {
  points: { bucket: Date; opens: number; clicks: number }[];
}) {
  if (points.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Etkileşim verisi geldiğinde zaman çizelgesi burada görünür.
      </p>
    );
  const max = Math.max(1, ...points.map((p) => Math.max(p.opens, p.clicks)));
  const w = Math.max(320, points.length * 14);
  const h = 120;
  const bar = 10;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Saatlik etkileşim</h3>
      <div className="overflow-x-auto rounded-lg border bg-surface p-3">
        <svg
          role="img"
          aria-label={`Saatlik açılma ve tıklama grafiği, ${points.length} saatlik veri`}
          viewBox={`0 0 ${w} ${h + 16}`}
          width={w}
          height={h + 16}
        >
          {points.map((p, i) => {
            const x = i * 14 + 2;
            const oh = (p.opens / max) * h;
            const ch = (p.clicks / max) * h;
            return (
              <g key={p.bucket.toISOString()}>
                <rect
                  x={x}
                  y={h - oh}
                  width={bar}
                  height={oh}
                  className="fill-primary"
                  opacity={0.85}
                >
                  <title>{`${p.bucket.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}: ${p.opens} açılma, ${p.clicks} tıklama`}</title>
                </rect>
                {p.clicks > 0 ? (
                  <rect
                    x={x + 3}
                    y={h - ch}
                    width={4}
                    height={ch}
                    className="fill-warning"
                  />
                ) : null}
              </g>
            );
          })}
          <line x1="0" x2={w} y1={h} y2={h} className="stroke-border" />
        </svg>
        <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
          <span>
            <span
              className="mr-1 inline-block size-2 rounded-sm bg-primary"
              aria-hidden="true"
            />
            Açılma
          </span>
          <span>
            <span
              className="mr-1 inline-block size-2 rounded-sm bg-warning"
              aria-hidden="true"
            />
            Tıklama
          </span>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Tablo olarak göster
        </summary>
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Saat (UTC)</TH>
                <TH>Açılma</TH>
                <TH>Tıklama</TH>
              </tr>
            </THead>
            <TBody>
              {points.map((p) => (
                <tr key={p.bucket.toISOString()}>
                  <TD>{p.bucket.toISOString().slice(0, 13).replace("T", " ")}:00</TD>
                  <TD>{p.opens}</TD>
                  <TD>{p.clicks}</TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </details>
    </div>
  );
}

const money = (v: number) =>
  v.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** What the campaign actually achieved, as reported by the customer's own systems (conversion API). */
function Outcomes({
  outcomes,
  stats,
}: {
  outcomes: ConversionStats;
  stats: CampaignStats;
}) {
  if (outcomes.total === 0)
    return (
      <div className="rounded-lg border border-dashed bg-surface p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Sonuçlar:</span> Henüz bu
        kampanyaya atfedilen bir dönüşüm yok. Satış, kayıt gibi sonuçları API ile
        bildirirseniz (<code>POST /api/v1/conversions</code>) burada açılma yerine
        gerçek sonucu görürsünüz.
      </div>
    );
  const base = stats.delivered || stats.sent;
  return (
    <section aria-labelledby="outcomes" className="flex flex-col gap-3">
      <h3 id="outcomes" className="text-base font-semibold">
        Sonuçlar
      </h3>
      <KpiGrid>
        <Kpi
          label="Dönüşen kişi"
          value={fmtNum(outcomes.people)}
          sub={base > 0 ? `${fmtPct(outcomes.people / base)} dönüşüm oranı` : undefined}
        />
        <Kpi
          label="Dönüşüm"
          value={fmtNum(outcomes.total)}
          sub={`${fmtNum(outcomes.viaClick)} tıklamadan sonra`}
        />
        <Kpi
          label="Değer"
          value={money(outcomes.revenue)}
          sub={
            stats.sent > 0
              ? `1.000 e-posta başına ${money((outcomes.revenue / stats.sent) * 1000)}`
              : undefined
          }
        />
      </KpiGrid>
      <ul className="divide-y rounded-lg border bg-surface text-sm">
        {outcomes.byName.map((n) => (
          <li
            key={n.name}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <span className="font-medium">{n.name}</span>
            <span className="text-muted-foreground">
              {fmtNum(n.count)} adet · {money(n.value)} · {fmtNum(n.viaClick)} tıklama
              atfı
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Atıf: kişinin dönüşümden önceki 30 günde en son tıkladığı kampanya; tıklama
        yoksa en son aldığı kampanya. “Tıklama atfı” güçlü sinyaldir, diğerleri yalnızca
        etkiyi gösterir.
      </p>
    </section>
  );
}
