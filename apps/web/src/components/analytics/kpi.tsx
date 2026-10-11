import type { ReactNode } from "react";

export const fmtPct = (v: number | null) =>
  v === null ? "—" : `%${(v * 100).toFixed(1).replace(".", ",")}`;
export const fmtNum = (n: number) => n.toLocaleString("tr-TR");

export function Kpi({
  label,
  value,
  sub,
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-surface p-4" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
