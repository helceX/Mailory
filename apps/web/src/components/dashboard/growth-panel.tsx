import Link from "next/link";
import { CAMPAIGN_PLAYBOOKS } from "@mailory/core";
import type { getGrowthOverview } from "@/lib/analytics/growth";
type Growth = Extract<Awaited<ReturnType<typeof getGrowthOverview>>, { ok: true }>;
export function GrowthPanel({
  data,
  canWrite,
  canManageApi,
}: {
  data: Growth;
  canWrite: boolean;
  canManageApi: boolean;
}) {
  return (
    <section
      aria-labelledby="growth-title"
      className="flex flex-col gap-4 rounded-lg border bg-surface p-5"
    >
      <h2 id="growth-title" className="text-lg font-semibold">
        Bir sonraki büyüme adımınız
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="font-medium">{data.action.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{data.action.detail}</p>
          <Link
            className="mt-2 inline-block text-sm text-primary hover:underline"
            href={data.action.href}
          >
            Adıma geç
          </Link>
        </div>
        <div>
          <h3 className="font-medium">{data.measurement.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.measurement.detail}
          </p>
          {canManageApi ? (
            <Link
              className="mt-2 inline-block text-sm text-primary hover:underline"
              href="/settings/developers"
            >
              Olay bağlantısını yönet
            </Link>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Olay bağlantısı için çalışma alanı yöneticinizle görüşün.
            </p>
          )}
        </div>
      </div>
      {data.signals.length ? (
        <p className="text-xs text-muted-foreground">
          Son 14 günde alınan hedefler:{" "}
          {data.signals
            .slice(0, 5)
            .map((s) => `${s.name} (${s.received})`)
            .join(" · ")}
          . Bunlar kampanyaya atfedilmiş satış sayısı değildir.
        </p>
      ) : null}
      {canWrite ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(CAMPAIGN_PLAYBOOKS).map(([key, plan]) => (
            <Link
              key={key}
              href={`/campaigns?playbook=${key}`}
              className="rounded-lg border p-3 hover:bg-muted"
            >
              <h3 className="text-sm font-medium">{plan.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>
            </Link>
          ))}
        </div>
      ) : null}
      {data.experiments.length ? (
        <div className="border-t pt-3">
          <h3 className="text-sm font-semibold">
            Son üç etki ölçümünden sonraki adımlar
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {data.experiments
              .filter((e) => e.report)
              .map((e) => (
                <li key={e.id}>
                  <Link
                    className="text-sm font-medium text-primary hover:underline"
                    href={`/campaigns/${e.id}`}
                  >
                    {e.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">{e.action}</p>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Mevcut veriye dayalı önerilerdir; otomatik gönderim veya satış garantisi
        içermez.
      </p>
    </section>
  );
}
