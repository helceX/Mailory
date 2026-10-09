"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Clock, GitBranch, Mail, Plus, Trash2 } from "lucide-react";
import {
  AUTOMATION_STATUS_LABELS,
  TRIGGER_LABELS,
  defaultStep,
  insertStep,
  moveStep,
  removeStep,
  updateStep,
  type AutomationStatus,
  type AutomationTrigger,
  type CampaignAudience,
  type ConditionStep,
  type DefinitionIssue,
  type Finding,
  type Slot,
  type Step,
} from "@mailory/core/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Field,
  Input,
  NativeSelect,
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

type Opt = { id: string; name: string };
type Stats = {
  sent: number;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  unsubscribed: number;
  bounced: number;
};

export type BuilderProps = {
  automation: {
    id: string;
    name: string;
    status: AutomationStatus;
    trigger: AutomationTrigger;
    steps: Step[];
  };
  templates: Opt[];
  identities: (Opt & { fromEmail: string; usable: boolean })[];
  lists: Opt[];
  tags: Opt[];
  issues: DefinitionIssue[];
  warnings: { stepId: string; findings: Finding[] }[];
  counts: Record<string, number>;
  exitReasons: { reason: string; n: number }[];
  stepStats: Record<string, Stats>;
  canWrite: boolean;
  canSend: boolean;
  requireApproval: boolean;
  canApprove: boolean;
};

const EXIT_TEXT: Record<string, string> = {
  no_longer_subscribed: "Abonelikten çıktı / bastırıldı",
  contact_deleted: "Kişi silindi",
  automation_archived: "Otomasyon arşivlendi",
  step_missing: "Adım bulunamadı",
  step_campaign_missing: "Adım kaydı eksik",
  too_many_steps: "Adım sınırı aşıldı",
};
const CHECK_LABELS = {
  opened_previous: "Önceki e-postayı açtı",
  clicked_previous: "Önceki e-postadaki bağlantıya tıkladı",
  has_tag: "Şu etikete sahip",
  in_list: "Şu listede",
} as const;

export function AutomationBuilder(p: BuilderProps) {
  const router = useRouter();
  const editable = p.automation.status === "draft" && p.canWrite;
  const [name, setName] = useState(p.automation.name);
  const [trigger, setTrigger] = useState<AutomationTrigger>(p.automation.trigger);
  const [steps, setSteps] = useState<Step[]>(p.automation.steps);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const edit = (next: Step[]) => {
    setSteps(next);
    setDirty(true);
    setNotice(null);
  };
  const issueFor = (id: string) => p.issues.filter((i) => i.stepId === id);
  const warnFor = (id: string) =>
    p.warnings.find((w) => w.stepId === id)?.findings ?? [];
  const defaults = {
    templateId: p.templates[0]?.id,
    senderIdentityId: (p.identities.find((i) => i.usable) ?? p.identities[0])?.id,
  };

  async function save() {
    setBusy("save");
    setError(null);
    const r = await apiCall(`/api/automations/${p.automation.id}`, "PATCH", {
      name,
      trigger,
      steps,
    });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    setDirty(false);
    setNotice("Kaydedildi.");
    router.refresh();
  }
  async function act(action: string) {
    setBusy(action);
    setError(null);
    if (action === "activate" && dirty && !(await saveQuiet())) {
      setBusy(null);
      return;
    }
    const r = await apiCall(`/api/automations/${p.automation.id}/${action}`, "POST");
    setBusy(null);
    if (!r.ok) return setError(r.message);
    router.refresh();
  }
  async function saveQuiet() {
    const r = await apiCall(`/api/automations/${p.automation.id}`, "PATCH", {
      name,
      trigger,
      steps,
    });
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setDirty(false);
    return true;
  }

  const globalIssues = p.issues.filter((i) => !i.stepId);
  const canActivate =
    editable &&
    p.canSend &&
    (!p.requireApproval || p.canApprove) &&
    !dirty &&
    p.issues.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        {editable ? (
          <Field id="a-name" label="Ad">
            <Input
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
        ) : null}

        <section className="rounded-lg border bg-surface p-4">
          <h2 className="text-sm font-semibold">Tetikleyici</h2>
          {editable ? (
            <div className="mt-2 flex flex-wrap gap-3">
              <NativeSelect
                aria-label="Tetikleyici türü"
                value={trigger.type}
                onChange={(e) => {
                  const t = e.target.value as AutomationTrigger["type"];
                  setTrigger(
                    t === "list_joined"
                      ? { type: t, listId: "" }
                      : t === "tag_added"
                        ? { type: t, tagId: "" }
                        : ({ type: t } as AutomationTrigger),
                  );
                  setDirty(true);
                }}
              >
                {(Object.keys(TRIGGER_LABELS) as AutomationTrigger["type"][]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {TRIGGER_LABELS[k]}
                    </option>
                  ),
                )}
              </NativeSelect>
              {trigger.type === "list_joined" ? (
                <NativeSelect
                  aria-label="Liste"
                  value={trigger.listId}
                  onChange={(e) => {
                    setTrigger({ type: "list_joined", listId: e.target.value });
                    setDirty(true);
                  }}
                >
                  <option value="">Liste seçin…</option>
                  {p.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {trigger.type === "tag_added" ? (
                <NativeSelect
                  aria-label="Etiket"
                  value={trigger.tagId}
                  onChange={(e) => {
                    setTrigger({ type: "tag_added", tagId: e.target.value });
                    setDirty(true);
                  }}
                >
                  <option value="">Etiket seçin…</option>
                  {p.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm">{TRIGGER_LABELS[trigger.type]}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Yalnızca otomasyon başladıktan sonra tetiklenen, abone ve bastırılmamış
            kişiler akışa girer.
          </p>
        </section>

        <Flow
          steps={steps}
          slot={{ parentId: null, branch: null }}
          editable={editable}
          depth={0}
          p={p}
          defaults={defaults}
          edit={edit}
          all={steps}
          issueFor={issueFor}
          warnFor={warnFor}
        />
        {globalIssues.length > 0 && editable && !dirty ? (
          <ul className="list-disc pl-5 text-sm text-danger">
            {globalIssues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <aside
        className="flex h-fit flex-col gap-4 rounded-lg border bg-surface p-4 lg:sticky lg:top-4"
        aria-label="Otomasyon durumu"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Durum</h2>
          <Badge
            tone={
              p.automation.status === "active"
                ? "success"
                : p.automation.status === "paused"
                  ? "warning"
                  : "neutral"
            }
          >
            {AUTOMATION_STATUS_LABELS[p.automation.status]}
          </Badge>
        </div>
        {notice ? (
          <p role="status" className="text-xs text-success">
            {notice}
          </p>
        ) : null}
        {editable ? (
          <>
            <Button onClick={save} disabled={!dirty || busy !== null}>
              {busy === "save" ? "Kaydediliyor…" : "Kaydet"}
            </Button>
            {p.issues.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Başlatmadan önce {p.issues.length} sorun giderilmeli.
              </p>
            ) : null}
            {dirty ? (
              <p className="text-xs text-muted-foreground">
                Kaydedilmemiş değişiklikler var.
              </p>
            ) : null}
            <ConfirmDialog
              trigger={
                <Button variant="secondary" disabled={!canActivate || busy !== null}>
                  Başlat
                </Button>
              }
              title="Otomasyon başlatılsın mı?"
              description="Başladıktan sonra akışın yapısı ve e-posta içerikleri dondurulur; tetiklenen herkese e-postalar kendiliğinden gönderilir. İstediğiniz zaman duraklatabilirsiniz."
              confirmLabel="Başlat"
              onConfirm={() => act("activate")}
            />
            {p.requireApproval && !p.canApprove ? (
              <p className="text-xs text-muted-foreground">
                Onay politikası açık: otomasyonu yalnızca onay yetkisi olan bir yönetici
                başlatabilir.
              </p>
            ) : null}
            <ConfirmDialog
              trigger={
                <Button variant="ghost" className="text-danger">
                  Taslağı sil
                </Button>
              }
              title="Taslak silinsin mi?"
              description="Bu işlem geri alınamaz."
              confirmLabel="Sil"
              onConfirm={async () => {
                const r = await apiCall(
                  `/api/automations/${p.automation.id}`,
                  "DELETE",
                );
                if (r.ok) router.push("/automations");
                else setError(r.message);
              }}
            />
          </>
        ) : (
          <>
            <Counts counts={p.counts} reasons={p.exitReasons} />
            {p.canSend && p.automation.status === "active" ? (
              <Button
                variant="secondary"
                onClick={() => act("pause")}
                disabled={busy !== null}
              >
                Duraklat
              </Button>
            ) : null}
            {p.canSend && p.automation.status === "paused" ? (
              <Button onClick={() => act("resume")} disabled={busy !== null}>
                Devam ettir
              </Button>
            ) : null}
            {p.canSend &&
            (p.automation.status === "active" || p.automation.status === "paused") ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" className="text-danger">
                    Arşivle
                  </Button>
                }
                title="Otomasyon arşivlensin mi?"
                description="Akıştaki herkes çıkarılır ve bir daha çalışmaz. Geri alınamaz."
                confirmLabel="Arşivle"
                onConfirm={() => act("archive")}
              />
            ) : null}
            {p.canWrite ? (
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await apiCall(
                    `/api/automations/${p.automation.id}/duplicate`,
                    "POST",
                  );
                  if (r.ok)
                    router.push(`/automations/${(r.data as { id: string }).id}`);
                  else setError(r.message);
                }}
              >
                Kopyasını oluştur
              </Button>
            ) : null}
            {p.canSend &&
            p.automation.status === "active" &&
            p.automation.trigger.type === "manual" ? (
              <EnrollButton id={p.automation.id} lists={p.lists} tags={p.tags} />
            ) : null}
          </>
        )}
        <Button asChild variant="ghost">
          <Link href="/automations">Otomasyonlara dön</Link>
        </Button>
      </aside>
    </div>
  );
}

function Counts({
  counts,
  reasons,
}: {
  counts: Record<string, number>;
  reasons: { reason: string; n: number }[];
}) {
  return (
    <div className="flex flex-col gap-1 text-sm" aria-live="polite">
      <div>
        Akışta: <strong>{counts.active ?? 0}</strong>
      </div>
      <div>
        Tamamlayan: <strong>{counts.completed ?? 0}</strong>
      </div>
      <div>
        Çıkan: <strong>{counts.exited ?? 0}</strong>
      </div>
      {reasons.length > 0 ? (
        <ul className="text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r.reason}>
              {EXIT_TEXT[r.reason] ?? r.reason}: {r.n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Flow({
  steps,
  slot,
  editable,
  depth,
  p,
  defaults,
  edit,
  all,
  issueFor,
  warnFor,
}: {
  steps: Step[];
  slot: Slot;
  editable: boolean;
  depth: number;
  p: BuilderProps;
  defaults: { templateId?: string; senderIdentityId?: string };
  edit: (s: Step[]) => void;
  all: Step[];
  issueFor: (id: string) => DefinitionIssue[];
  warnFor: (id: string) => Finding[];
}) {
  return (
    <div className={depth > 0 ? "ml-4 border-l-2 pl-4" : ""}>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s.id}>
            <StepCard
              step={s}
              index={i}
              count={steps.length}
              editable={editable}
              p={p}
              all={all}
              edit={edit}
              issues={issueFor(s.id)}
              warns={warnFor(s.id)}
            />
            {s.type === "condition" ? (
              <div className="mt-2 grid gap-3">
                {(["yes", "no"] as const).map((b) => (
                  <div key={b}>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {b === "yes" ? "Evet ise" : "Hayır ise"}
                    </div>
                    <Flow
                      steps={(s as ConditionStep)[b]}
                      slot={{ parentId: s.id, branch: b }}
                      editable={editable}
                      depth={depth + 1}
                      p={p}
                      defaults={defaults}
                      edit={edit}
                      all={all}
                      issueFor={issueFor}
                      warnFor={warnFor}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => edit(insertStep(all, slot, defaultStep("email", defaults)))}
          >
            <Mail className="size-4" aria-hidden="true" /> E-posta
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => edit(insertStep(all, slot, defaultStep("wait")))}
          >
            <Clock className="size-4" aria-hidden="true" /> Bekle
          </Button>
          {depth < 2 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => edit(insertStep(all, slot, defaultStep("condition")))}
            >
              <GitBranch className="size-4" aria-hidden="true" /> Koşul
            </Button>
          ) : null}
        </div>
      ) : steps.length === 0 && depth > 0 ? (
        <p className="text-xs text-muted-foreground">
          Bu dalda adım yok; akış burada biter.
        </p>
      ) : null}
      {editable && steps.length === 0 && depth === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <Plus className="inline size-3" aria-hidden="true" /> İlk adımı ekleyin.
        </p>
      ) : null}
    </div>
  );
}

function StepCard({
  step,
  index,
  count,
  editable,
  p,
  all,
  edit,
  issues,
  warns,
}: {
  step: Step;
  index: number;
  count: number;
  editable: boolean;
  p: BuilderProps;
  all: Step[];
  edit: (s: Step[]) => void;
  issues: DefinitionIssue[];
  warns: Finding[];
}) {
  const set = (patch: Partial<Step>) =>
    edit(updateStep(all, step.id, (s) => ({ ...s, ...patch }) as Step));
  const stats = p.stepStats[step.id];
  return (
    <div
      className={`rounded-lg border bg-surface p-3 ${issues.length ? "border-danger/60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {step.type === "email" ? (
            <Mail className="size-4" aria-hidden="true" />
          ) : step.type === "wait" ? (
            <Clock className="size-4" aria-hidden="true" />
          ) : (
            <GitBranch className="size-4" aria-hidden="true" />
          )}
          {step.type === "email"
            ? "E-posta gönder"
            : step.type === "wait"
              ? "Bekle"
              : "Koşul"}
        </div>
        {editable ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Yukarı taşı"
              disabled={index === 0}
              onClick={() => edit(moveStep(all, step.id, -1))}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Aşağı taşı"
              disabled={index === count - 1}
              onClick={() => edit(moveStep(all, step.id, 1))}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Adımı sil"
              onClick={() => edit(removeStep(all, step.id))}
            >
              <Trash2 className="size-4 text-danger" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-2 text-sm">
        {step.type === "email" ? (
          editable ? (
            <>
              <Field id={`s-${step.id}-subj`} label="Konu">
                <Input
                  value={step.subject}
                  maxLength={200}
                  onChange={(e) => set({ subject: e.target.value })}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Field
                  id={`s-${step.id}-t`}
                  label="Şablon"
                  className="min-w-[180px] flex-1"
                >
                  <NativeSelect
                    value={step.templateId}
                    onChange={(e) => set({ templateId: e.target.value })}
                  >
                    <option value="">Seçin…</option>
                    {p.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  id={`s-${step.id}-f`}
                  label="Kimden"
                  className="min-w-[180px] flex-1"
                >
                  <NativeSelect
                    value={step.senderIdentityId}
                    onChange={(e) => set({ senderIdentityId: e.target.value })}
                  >
                    <option value="">Seçin…</option>
                    {p.identities.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} &lt;{i.fromEmail}&gt;
                        {i.usable ? "" : " — doğrulanmamış"}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </>
          ) : (
            <div>
              <span className="text-muted-foreground">Konu: </span>
              {step.subject}
            </div>
          )
        ) : null}
        {step.type === "wait" ? (
          editable ? (
            <div className="flex items-end gap-2">
              <Field id={`s-${step.id}-n`} label="Süre">
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  value={step.amount}
                  onChange={(e) =>
                    set({ amount: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </Field>
              <NativeSelect
                aria-label="Birim"
                value={step.unit}
                onChange={(e) =>
                  set({ unit: e.target.value as "minutes" | "hours" | "days" })
                }
              >
                <option value="minutes">dakika</option>
                <option value="hours">saat</option>
                <option value="days">gün</option>
              </NativeSelect>
            </div>
          ) : (
            <div>
              {step.amount}{" "}
              {step.unit === "days" ? "gün" : step.unit === "hours" ? "saat" : "dakika"}
            </div>
          )
        ) : null}
        {step.type === "condition" ? (
          editable ? (
            <div className="flex flex-wrap gap-3">
              <NativeSelect
                aria-label="Koşul"
                value={step.check.kind}
                onChange={(e) => {
                  const k = e.target.value as keyof typeof CHECK_LABELS;
                  set({
                    check:
                      k === "has_tag"
                        ? { kind: k, tagId: "" }
                        : k === "in_list"
                          ? { kind: k, listId: "" }
                          : { kind: k },
                  } as Partial<Step>);
                }}
              >
                {(Object.keys(CHECK_LABELS) as (keyof typeof CHECK_LABELS)[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {CHECK_LABELS[k]}
                    </option>
                  ),
                )}
              </NativeSelect>
              {step.check.kind === "has_tag" ? (
                <NativeSelect
                  aria-label="Etiket"
                  value={step.check.tagId}
                  onChange={(e) =>
                    set({
                      check: { kind: "has_tag", tagId: e.target.value },
                    } as Partial<Step>)
                  }
                >
                  <option value="">Etiket seçin…</option>
                  {p.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {step.check.kind === "in_list" ? (
                <NativeSelect
                  aria-label="Liste"
                  value={step.check.listId}
                  onChange={(e) =>
                    set({
                      check: { kind: "in_list", listId: e.target.value },
                    } as Partial<Step>)
                  }
                >
                  <option value="">Liste seçin…</option>
                  {p.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
            </div>
          ) : (
            <div>{CHECK_LABELS[step.check.kind]}</div>
          )
        ) : null}
        {stats && step.type === "email" ? (
          <div className="text-xs text-muted-foreground">
            Gönderilen {stats.sent} · Açan {stats.uniqueOpens} · Tıklayan{" "}
            {stats.uniqueClicks} · Çıkan {stats.unsubscribed}
          </div>
        ) : null}
        {issues.map((i) => (
          <p key={i.message} role="alert" className="text-xs text-danger">
            {i.message}
          </p>
        ))}
        {warns.slice(0, 3).map((w) => (
          <p key={w.code} className="text-xs text-muted-foreground">
            ⚠ {w.message}
          </p>
        ))}
      </div>
    </div>
  );
}

function EnrollButton({ id, lists, tags }: { id: string; lists: Opt[]; tags: Opt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CampaignAudience["kind"]>("list");
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setMsg(null);
      }}
    >
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Kişileri akışa ekle
      </Button>
      <DialogContent
        title="Kişileri akışa ekle"
        description="Seçilen kitledeki abone ve bastırılmamış kişiler (en fazla 5.000) akışa alınır. Bir kişi bir otomasyona yalnızca bir kez girer."
      >
        <div className="mt-4 flex flex-col gap-3">
          <NativeSelect
            aria-label="Kitle türü"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CampaignAudience["kind"]);
              setRef("");
            }}
          >
            <option value="list">Bir liste</option>
            <option value="tag">Bir etiket</option>
            <option value="all">Tüm aboneler</option>
          </NativeSelect>
          {kind !== "all" ? (
            <NativeSelect
              aria-label="Seçim"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            >
              <option value="">Seçin…</option>
              {(kind === "list" ? lists : tags).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {msg ? (
            <p
              role={msg.ok ? "status" : "alert"}
              className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}
            >
              {msg.text}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              disabled={kind !== "all" && !ref}
              onClick={async () => {
                const audience = kind === "all" ? { kind } : { kind, id: ref };
                const r = await apiCall(`/api/automations/${id}/enroll`, "POST", {
                  audience,
                });
                if (r.ok) {
                  setMsg({
                    ok: true,
                    text: `${(r.data as { enrolled: number }).enrolled} kişi akışa eklendi.`,
                  });
                  router.refresh();
                } else setMsg({ ok: false, text: r.message });
              }}
            >
              Ekle
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
