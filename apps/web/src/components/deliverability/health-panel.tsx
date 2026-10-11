import {
  HEALTH_BAND_LABELS,
  type Finding,
  type HealthBand,
} from "@mailory/core/shared";
import { Badge } from "@mailory/ui";

export const BAND_TONE: Record<HealthBand, "success" | "warning" | "danger"> = {
  good: "success",
  attention: "warning",
  risky: "danger",
};
const SEV_LABEL = { critical: "Kritik", warning: "Uyarı", info: "Bilgi" } as const;
const SEV_TONE = { critical: "danger", warning: "warning", info: "neutral" } as const;

/** Content health: the score, then every finding with how to fix it. */
export function HealthPanel({
  score,
  band,
  findings,
}: {
  score: number;
  band: HealthBand;
  findings: Finding[];
}) {
  return (
    <section aria-label="İçerik sağlığı" className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">İçerik sağlığı</h3>
        <Badge tone={BAND_TONE[band]}>
          {HEALTH_BAND_LABELS[band]} · {score}
        </Badge>
      </div>
      {findings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Dikkat çeken bir sorun bulunmadı.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-xs">
          {findings.map((f) => (
            <li key={f.code} className="rounded border p-2">
              <div className="flex items-center gap-2">
                <Badge tone={SEV_TONE[f.severity]}>{SEV_LABEL[f.severity]}</Badge>
                <span>{f.message}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{f.fix}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Kural tabanlı bir tahmindir; gelen kutusuna ulaşmayı garanti etmez.
      </p>
    </section>
  );
}
