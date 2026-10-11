import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@mailory/ui";

type Step = {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
};

/** Derived from live data (see getOnboarding), so what it shows is always true. */
export function OnboardingChecklist({
  steps,
  completed,
  total,
}: {
  steps: Step[];
  completed: number;
  total: number;
}) {
  const next = steps.find((s) => !s.done);
  const percent = Math.round((completed / total) * 100);
  return (
    <section aria-labelledby="onb-title" className="rounded-lg border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="onb-title" className="text-base font-semibold">
            Kurulumu tamamlayın
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            İlk e-postanızı göndermeye hazırlanmak için birkaç adım kaldı.
          </p>
        </div>
        <p
          className="text-sm font-medium tabular-nums"
          aria-label={`${total} adımın ${completed} tanesi tamamlandı`}
        >
          {completed} / {total} tamamlandı
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label="Kurulum ilerlemesi"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="mt-4 divide-y">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3 py-3">
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${s.done ? "border-success bg-success text-success-foreground" : "border-border-strong"}`}
              aria-hidden="true"
            >
              {s.done ? <Check className="size-3" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}
              >
                {s.title}
                <span className="sr-only">
                  {s.done ? " (tamamlandı)" : " (yapılacak)"}
                </span>
              </p>
              {!s.done ? (
                <p className="text-xs text-muted-foreground">{s.description}</p>
              ) : null}
            </div>
            {!s.done ? (
              <Button
                asChild
                variant={s.key === next?.key ? "primary" : "secondary"}
                size="sm"
              >
                <Link href={s.href}>Başla</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
