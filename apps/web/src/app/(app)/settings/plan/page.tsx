import { ENTITLEMENT_LABELS } from "@mailory/core";
import { Badge } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import { getPlanOverview } from "@/lib/billing/service";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Plan ve kullanım" };
export const dynamic = "force-dynamic";

const SOURCE = {
  default: "Varsayılan plan",
  manual: "Elle atanmış",
  stripe: "Abonelik",
} as const;

export default async function PlanPage() {
  const actor = (await getOrgContext())!.actor!;
  const r = await getPlanOverview({ db: getDb().db }, actor);
  if (!r.ok)
    return (
      <p className="text-sm text-muted-foreground">
        Bu sayfayı görüntüleme yetkiniz yok.
      </p>
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plan ve kullanım"
        description="Çalışma alanınızın planı ve limitlere göre kullanımınız."
      />
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-4">
        <div>
          <div className="text-xs text-muted-foreground">Plan</div>
          <div className="text-xl font-extrabold">{r.planName}</div>
        </div>
        <Badge tone="info">{SOURCE[r.source as keyof typeof SOURCE] ?? r.source}</Badge>
        {r.status !== "active" ? <Badge tone="warning">{r.status}</Badge> : null}
        {r.suspended ? <Badge tone="danger">Askıya alındı</Badge> : null}
      </section>
      <ul className="grid gap-3 sm:grid-cols-2">
        {r.rows.map((row) => {
          const e = ENTITLEMENT_LABELS[row.key];
          const pct =
            row.limit === null || row.limit === 0
              ? row.limit === 0
                ? 100
                : 0
              : Math.min(100, Math.round((row.used / row.limit) * 100));
          return (
            <li key={row.key} className="rounded-lg border bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">
                  {e.label}
                  {e.period === "month" ? " (bu ay)" : ""}
                </span>
                <span className="text-sm tabular-nums">
                  {row.used.toLocaleString("tr-TR")} /{" "}
                  {row.limit === null ? "Sınırsız" : row.limit.toLocaleString("tr-TR")}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded bg-secondary"
                role="progressbar"
                aria-label={e.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className={`h-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {row.overridden ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Bu limit çalışma alanınıza özel ayarlanmış.
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Limitleri artırmak için yöneticinizle iletişime geçin. Limit dolduğunda mevcut
        verileriniz silinmez; yalnızca yeni ekleme/gönderim durur.
      </p>
    </div>
  );
}
