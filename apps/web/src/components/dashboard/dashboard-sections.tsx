import Link from "next/link";
import { AlertTriangle, Mail, Plus, Upload } from "lucide-react";
import { Badge, Button } from "@mailory/ui";
import {
  CAMPAIGN_STATUS_LABELS,
  ENTITLEMENT_LABELS,
  type CampaignStatus,
  type EntitlementKey,
} from "@mailory/core/shared";
import { STATUS_TONE, formatWhen } from "../campaigns/labels";

export function QuickActions({ canWrite }: { canWrite: boolean }) {
  if (!canWrite) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href="/campaigns">
          <Plus aria-hidden="true" /> Yeni kampanya
        </Link>
      </Button>
      <Button asChild variant="secondary">
        <Link href="/audience/contacts">
          <Upload aria-hidden="true" /> Kişi içe aktar
        </Link>
      </Button>
      <Button asChild variant="secondary">
        <Link href="/templates">
          <Mail aria-hidden="true" /> Şablonlar
        </Link>
      </Button>
    </div>
  );
}

export type Alert = {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  fix?: string;
};

/** Things that need attention now (sender problems, paused campaigns). Only critical/warning items appear. */
export function AttentionList({ alerts }: { alerts: Alert[] }) {
  const items = alerts.filter((a) => a.severity !== "info").slice(0, 4);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="attention" className="flex flex-col gap-2">
      <h2 id="attention" className="text-lg font-semibold">
        Dikkat gerektirenler
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((a) => (
          <li
            key={a.id}
            className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${a.severity === "critical" ? "border-danger/40 bg-danger/5" : "border-warning/40 bg-warning/10"}`}
          >
            <AlertTriangle
              className={`mt-0.5 size-4 shrink-0 ${a.severity === "critical" ? "text-danger" : "text-warning-text"}`}
              aria-hidden="true"
            />
            <div className="flex-1">
              <div className="font-medium">{a.message}</div>
              {a.fix ? <div className="text-muted-foreground">{a.fix}</div> : null}
            </div>
            <Link
              href="/deliverability"
              className="shrink-0 text-primary hover:underline"
            >
              Ayrıntı
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type UsageRow = { key: EntitlementKey; used: number; limit: number | null };

const SHOWN: EntitlementKey[] = ["contacts", "emails_per_month"];

/** Plan usage for the two limits people hit first. Bars turn amber at 80% and red when full. */
export function UsagePanel({ planName, rows }: { planName: string; rows: UsageRow[] }) {
  const shown = SHOWN.map((k) => rows.find((r) => r.key === k)).filter(
    (r): r is UsageRow => Boolean(r),
  );
  return (
    <section aria-labelledby="usage" className="rounded-lg border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 id="usage" className="text-lg font-semibold">
          Plan kullanımı
        </h2>
        <span className="flex items-center gap-2 text-sm">
          <Badge tone="info">{planName}</Badge>
          <Link href="/settings/plan" className="text-primary hover:underline">
            Tümü
          </Link>
        </span>
      </div>
      <ul className="mt-3 grid gap-4 sm:grid-cols-2">
        {shown.map((r) => {
          const meta = ENTITLEMENT_LABELS[r.key];
          const ratio = r.limit === null ? 0 : r.limit === 0 ? 1 : r.used / r.limit;
          const pct = Math.min(100, Math.round(ratio * 100));
          const tone =
            ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warning" : "bg-primary";
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">
                  {meta.label}
                  {meta.period === "month" ? " (bu ay)" : ""}
                </span>
                <span className="tabular-nums">
                  {r.used.toLocaleString("tr-TR")} /{" "}
                  {r.limit === null ? "Sınırsız" : r.limit.toLocaleString("tr-TR")}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded bg-secondary"
                role="progressbar"
                aria-label={meta.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
              </div>
              {ratio >= 0.8 && r.limit !== null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {ratio >= 1
                    ? "Limite ulaştınız; yeni eklemeler/gönderimler durur."
                    : "Limitin %80'ine ulaştınız."}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type RecentCampaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  updatedAt: string;
};

export function RecentCampaigns({ rows }: { rows: RecentCampaign[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="recent" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="recent" className="text-lg font-semibold">
          Son kampanyalar
        </h2>
        <Link href="/campaigns" className="text-sm text-primary hover:underline">
          Tümü
        </Link>
      </div>
      <ul className="divide-y rounded-lg border bg-surface">
        {rows.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <Link
              href={`/campaigns/${c.id}`}
              className="font-medium text-primary hover:underline"
            >
              {c.name}
            </Link>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground">
                {c.status === "scheduled"
                  ? formatWhen(c.scheduledAt)
                  : formatWhen(c.updatedAt)}
              </span>
              <Badge tone={STATUS_TONE[c.status]}>
                {CAMPAIGN_STATUS_LABELS[c.status]}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
