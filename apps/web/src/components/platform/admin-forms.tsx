"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ENTITLEMENT_LABELS,
  PLAN_LABELS,
  type EntitlementKey,
  type PlanKey,
} from "@mailory/core/shared";
import { Badge, Button, ConfirmDialog, Field, Input, NativeSelect } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

type Row = {
  key: EntitlementKey;
  limit: number | null;
  used: number;
  overridden: boolean;
};

/** Generic "POST then refresh" form wrapper. */
function useAct() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(
    url: string,
    method: string,
    body: unknown,
    success = "Kaydedildi.",
  ) {
    setBusy(true);
    setError(null);
    setOk(null);
    const r = await apiCall(url, method, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return null;
    }
    setOk(success);
    router.refresh();
    return r.data;
  }
  return { error, ok, busy, run, router };
}

export function CreateOrgForm({
  endpoint,
  title,
  hint,
  submit,
}: {
  endpoint: string;
  title: string;
  hint: string;
  submit: string;
}) {
  const { error, ok, busy, run, router } = useAct();
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const data = (await run(
          endpoint,
          "POST",
          { name: f.get("name"), ownerEmail: f.get("ownerEmail") },
          "Oluşturuldu; sahibine davet e-postası gönderildi.",
        )) as { id: string } | null;
        if (data) (e.target as HTMLFormElement).reset();
        void router;
      }}
    >
      <div className="w-full text-sm font-semibold">{title}</div>
      <Field id="co-name" label="Ad" className="min-w-[200px] flex-1">
        <Input name="name" required maxLength={120} />
      </Field>
      <Field
        id="co-owner"
        label="Sahibinin e-postası"
        hint={hint}
        className="min-w-[240px] flex-1"
      >
        <Input name="ownerEmail" type="email" required />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? "Oluşturuluyor…" : submit}
      </Button>
      <div className="w-full">
        <FormError message={error} />
        {ok ? (
          <p role="status" className="text-sm text-success">
            {ok}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function LimitsEditor({
  endpoint,
  rows,
  allowUnlimited,
}: {
  endpoint: string;
  rows: Row[];
  allowUnlimited: boolean;
}) {
  const { error, ok, busy, run } = useAct();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.key, r.limit === null ? "" : String(r.limit)]),
    ),
  );
  return (
    <section aria-labelledby="limits" className="flex flex-col gap-2">
      <h2 id="limits" className="text-lg font-semibold">
        Limitler ve kullanım
      </h2>
      <FormError message={error} />
      {ok ? (
        <p role="status" className="text-sm text-success">
          {ok}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 text-sm"
          >
            <div className="min-w-[160px] flex-1">
              <div className="font-medium">{ENTITLEMENT_LABELS[r.key].label}</div>
              <div className="text-xs text-muted-foreground">
                Kullanım: {r.used.toLocaleString("tr-TR")} · Etkin limit:{" "}
                {r.limit === null ? "Sınırsız" : r.limit.toLocaleString("tr-TR")}{" "}
                {r.overridden ? <Badge tone="info">Özel</Badge> : null}
              </div>
            </div>
            <Input
              aria-label={`${ENTITLEMENT_LABELS[r.key].label} limiti`}
              className="w-32"
              type="number"
              min={0}
              placeholder={allowUnlimited ? "Sınırsız" : "Limit"}
              value={vals[r.key]}
              onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || (vals[r.key] === "" && !allowUnlimited)}
              onClick={() =>
                run(endpoint, "PATCH", {
                  action: "limit",
                  key: r.key,
                  limit: vals[r.key] === "" ? null : Number(vals[r.key]),
                  reason: "Elle ayarlandı",
                })
              }
            >
              Uygula
            </Button>
            {r.overridden ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(
                    endpoint,
                    "PATCH",
                    { action: "limit", key: r.key, limit: "clear" },
                    "Plan limitine döndü.",
                  )
                }
              >
                Plana dön
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlanPicker({
  endpoint,
  plans,
  current,
}: {
  endpoint: string;
  plans: PlanKey[];
  current: string;
}) {
  const { error, ok, busy, run } = useAct();
  const [plan, setPlan] = useState(current);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field id="plan" label="Plan">
        <NativeSelect value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plans.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button
        disabled={busy || plan === current}
        onClick={() => run(endpoint, "PATCH", { action: "plan", planKey: plan })}
      >
        Planı uygula
      </Button>
      <FormError message={error} />
      {ok ? (
        <span role="status" className="text-sm text-success">
          {ok}
        </span>
      ) : null}
    </div>
  );
}

export function SuspendControls({
  endpoint,
  suspended,
  reason,
  reinstateAction = "reinstate",
  suspendAction = "suspend",
}: {
  endpoint: string;
  suspended: boolean;
  reason: string | null;
  reinstateAction?: string;
  suspendAction?: string;
}) {
  const { error, busy, run } = useAct();
  const [why, setWhy] = useState("");
  return (
    <section
      aria-labelledby="susp"
      className="flex flex-col gap-2 rounded-lg border bg-surface p-4"
    >
      <h2 id="susp" className="text-sm font-semibold">
        Durum
      </h2>
      {suspended ? (
        <>
          <p className="text-sm">
            <Badge tone="danger">Askıya alındı</Badge> {reason}
          </p>
          <div>
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  endpoint,
                  "PATCH",
                  { action: reinstateAction },
                  "Yeniden etkinleştirildi.",
                )
              }
            >
              Yeniden etkinleştir
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            id="why"
            label="Askıya alma gerekçesi"
            className="min-w-[240px] flex-1"
          >
            <Input
              value={why}
              maxLength={300}
              onChange={(e) => setWhy(e.target.value)}
            />
          </Field>
          <ConfirmDialog
            trigger={
              <Button
                variant="secondary"
                className="text-danger"
                disabled={busy || !why.trim()}
              >
                Askıya al
              </Button>
            }
            title="Çalışma alanı askıya alınsın mı?"
            description="Yeni gönderim durur, çalışan kampanyalar duraklatılır. Veriler silinmez ve kullanıcı verilerine erişmeye devam eder. İstediğiniz zaman geri açabilirsiniz."
            confirmLabel="Askıya al"
            onConfirm={async () =>
              void (await run(
                endpoint,
                "PATCH",
                { action: suspendAction, reason: why },
                "Askıya alındı.",
              ))
            }
          />
        </div>
      )}
      <FormError message={error} />
    </section>
  );
}

export function DailyLimit({
  endpoint,
  current,
}: {
  endpoint: string;
  current: number;
}) {
  const { error, ok, busy, run } = useAct();
  const [v, setV] = useState(String(current));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field
        id="daily"
        label="Günlük gönderim sınırı"
        hint="Kötüye kullanım koruması; UTC gün başında sıfırlanır."
      >
        <Input
          type="number"
          min={0}
          className="w-40"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      </Field>
      <Button
        variant="secondary"
        disabled={busy || v === "" || Number(v) === current}
        onClick={() => run(endpoint, "PATCH", { action: "daily", limit: Number(v) })}
      >
        Uygula
      </Button>
      <FormError message={error} />
      {ok ? (
        <span role="status" className="text-sm text-success">
          {ok}
        </span>
      ) : null}
    </div>
  );
}

export function KindControls({
  endpoint,
  type,
  parentId,
  partners,
}: {
  endpoint: string;
  type: string;
  parentId: string | null;
  partners: { id: string; name: string }[];
}) {
  const { error, ok, busy, run } = useAct();
  const [t, setT] = useState(type);
  const [parent, setParent] = useState(parentId ?? "");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field id="kind" label="Tür">
        <NativeSelect
          value={t}
          onChange={(e) => {
            setT(e.target.value);
            if (e.target.value === "partner") setParent("");
          }}
        >
          <option value="standard">Standart</option>
          <option value="partner">Partner</option>
        </NativeSelect>
      </Field>
      <Field id="parent" label="Sponsor (üst kurum)">
        <NativeSelect
          value={parent}
          disabled={t === "partner"}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">Yok</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          run(endpoint, "PATCH", {
            action: "kind",
            type: t,
            parentOrganizationId: parent || null,
          })
        }
      >
        Uygula
      </Button>
      <FormError message={error} />
      {ok ? (
        <span role="status" className="text-sm text-success">
          {ok}
        </span>
      ) : null}
    </div>
  );
}

export function EndSponsorship({ endpoint }: { endpoint: string }) {
  const { error, busy, run } = useAct();
  return (
    <div>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" className="text-danger" disabled={busy}>
            Sponsorluğu sonlandır
          </Button>
        }
        title="Sponsorluk sonlandırılsın mı?"
        description="Çalışma alanı ücretsiz plana geçer; verileri silinmez ama ücretsiz plan sınırları geçerli olur."
        confirmLabel="Sonlandır"
        onConfirm={async () =>
          void (await run(
            endpoint,
            "PATCH",
            { action: "end_sponsorship" },
            "Sponsorluk sona erdi.",
          ))
        }
      />
      <FormError message={error} />
    </div>
  );
}

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">
      ← {children}
    </Link>
  );
}
