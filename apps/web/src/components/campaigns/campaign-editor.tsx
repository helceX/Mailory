"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  slugifyUtm,
  type CampaignAudience,
  type CampaignUtm,
  type Finding,
  type HealthBand,
  type ReadinessIssue,
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
import { SubjectAssistant, type AiStatus } from "../ai/ai-panels";
import { HealthPanel } from "../deliverability/health-panel";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

type Option = { id: string; name: string };
export type EditorProps = {
  campaign: {
    id: string;
    name: string;
    subject: string;
    preheader: string;
    senderIdentityId: string | null;
    replyTo: string | null;
    templateId: string | null;
    audience: CampaignAudience | null;
    utm: CampaignUtm;
    trackOpens: boolean;
    trackClicks: boolean;
    rejectionReason: string | null;
  };
  issues: ReadinessIssue[];
  ai: AiStatus;
  health: { score: number; band: HealthBand; findings: Finding[] };
  audienceCount: number;
  requireApproval: boolean;
  canSend: boolean;
  identities: (Option & { fromEmail: string; usable: boolean })[];
  templates: Option[];
  lists: Option[];
  segments: Option[];
  tags: Option[];
  testRecipients: { email: string; name: string; self: boolean }[];
};

export function CampaignEditor(props: EditorProps) {
  const { campaign } = props;
  const router = useRouter();
  const [form, setForm] = useState({
    name: campaign.name,
    subject: campaign.subject,
    preheader: campaign.preheader,
    senderIdentityId: campaign.senderIdentityId ?? "",
    replyTo: campaign.replyTo ?? "",
    templateId: campaign.templateId ?? "",
    audienceKind: campaign.audience?.kind ?? "",
    audienceId:
      campaign.audience && "id" in campaign.audience ? campaign.audience.id : "",
    utm: campaign.utm,
    trackOpens: campaign.trackOpens,
    trackClicks: campaign.trackClicks,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState("");

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setNotice(null);
  };
  const setUtm = (patch: Partial<CampaignUtm>) => set("utm", { ...form.utm, ...patch });

  function audiencePayload(): CampaignAudience | null {
    if (!form.audienceKind) return null;
    if (form.audienceKind === "all") return { kind: "all" };
    return form.audienceId
      ? ({ kind: form.audienceKind, id: form.audienceId } as CampaignAudience)
      : null;
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    setError(null);
    const r = await apiCall(`/api/campaigns/${campaign.id}`, "PATCH", {
      name: form.name,
      subject: form.subject,
      preheader: form.preheader,
      senderIdentityId: form.senderIdentityId || null,
      replyTo: form.replyTo,
      templateId: form.templateId || null,
      audience: audiencePayload(),
      utm: {
        ...form.utm,
        content: form.utm.content ?? "",
        term: form.utm.term ?? "",
      },
      trackOpens: form.trackOpens,
      trackClicks: form.trackClicks,
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setDirty(false);
    setNotice("Kaydedildi.");
    router.refresh();
    return true;
  }

  async function act(kind: "schedule" | "submit") {
    setError(null);
    if (sendMode === "later" && !sendAt) return setError("Gönderim zamanını seçin.");
    if (dirty && !(await save())) return;
    setBusy(kind);
    const r = await apiCall(`/api/campaigns/${campaign.id}/${kind}`, "POST", {
      sendAt: sendMode === "later" ? new Date(sendAt).toISOString() : null,
    });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    router.refresh();
  }

  const blockers = props.issues.filter((i) => i.severity === "blocker");
  const warnings = props.issues.filter((i) => i.severity === "warning");
  const ready = blockers.length === 0 && !dirty;
  const audienceOptions =
    form.audienceKind === "list"
      ? props.lists
      : form.audienceKind === "segment"
        ? props.segments
        : form.audienceKind === "tag"
          ? props.tags
          : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        {campaign.rejectionReason ? (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
          >
            <strong>Onay reddedildi:</strong> {campaign.rejectionReason}
          </div>
        ) : null}
        <FormError message={error} />

        <Section title="1. Temel bilgiler">
          <Field
            id="c-name"
            label="Kampanya adı"
            hint="Yalnızca sizin göreceğiniz iç ad."
          >
            <Input
              value={form.name}
              maxLength={120}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field
            id="c-subject"
            label="Konu satırı"
            hint="{{first_name|dost}} gibi kişiselleştirme kullanabilirsiniz."
          >
            <Input
              value={form.subject}
              maxLength={200}
              onChange={(e) => set("subject", e.target.value)}
            />
          </Field>
          <Field
            id="c-pre"
            label="Ön izleme metni (isteğe bağlı)"
            hint="Gelen kutusunda konunun yanında görünen kısa özet."
          >
            <Input
              value={form.preheader}
              maxLength={200}
              onChange={(e) => set("preheader", e.target.value)}
            />
          </Field>
        </Section>

        <Section title="2. Gönderici">
          <Field id="c-sender" label="Kimden">
            <NativeSelect
              value={form.senderIdentityId}
              onChange={(e) => set("senderIdentityId", e.target.value)}
            >
              <option value="">Seçin…</option>
              {props.identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} &lt;{i.fromEmail}&gt;{i.usable ? "" : " — doğrulanmamış"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {props.identities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Henüz gönderici yok.{" "}
              <Link href="/settings/senders" className="text-primary hover:underline">
                Gönderici ekleyin
              </Link>
              .
            </p>
          ) : null}
          <Field
            id="c-reply"
            label="Yanıt adresi (isteğe bağlı)"
            hint="Boşsa göndericinin yanıt adresi kullanılır."
          >
            <Input
              type="email"
              value={form.replyTo}
              onChange={(e) => set("replyTo", e.target.value)}
            />
          </Field>
        </Section>

        <Section title="3. İçerik">
          <Field
            id="c-template"
            label="Şablon"
            hint="Gönderime alındığında şablonun o anki sürümü dondurulur."
          >
            <NativeSelect
              value={form.templateId}
              onChange={(e) => set("templateId", e.target.value)}
            >
              <option value="">Seçin…</option>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {form.templateId ? (
            <Link
              href={`/templates/${form.templateId}`}
              className="text-sm text-primary hover:underline"
            >
              Şablonu düzenle
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">
              Şablon yok mu?{" "}
              <Link href="/templates" className="text-primary hover:underline">
                Şablonlar
              </Link>{" "}
              sayfasından oluşturun.
            </p>
          )}
        </Section>

        <Section title="4. Kitle">
          <div className="flex flex-wrap gap-3">
            <Field id="c-aud" label="Kime" className="min-w-[200px]">
              <NativeSelect
                value={form.audienceKind}
                onChange={(e) => {
                  set("audienceKind", e.target.value as typeof form.audienceKind);
                  set("audienceId", "");
                }}
              >
                <option value="">Seçin…</option>
                <option value="all">Tüm aboneler</option>
                <option value="list">Bir liste</option>
                <option value="segment">Bir segment</option>
                <option value="tag">Bir etiket</option>
              </NativeSelect>
            </Field>
            {form.audienceKind && form.audienceKind !== "all" ? (
              <Field id="c-aud-id" label="Seçim" className="min-w-[220px] flex-1">
                <NativeSelect
                  value={form.audienceId}
                  onChange={(e) => set("audienceId", e.target.value)}
                >
                  <option value="">Seçin…</option>
                  {audienceOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>
          <p className="text-sm" aria-live="polite">
            {dirty ? (
              <span className="text-muted-foreground">Alıcı sayısı için kaydedin.</span>
            ) : (
              <>
                Gönderilebilir alıcı:{" "}
                <strong>{props.audienceCount.toLocaleString("tr-TR")}</strong>
                <span className="text-muted-foreground">
                  {" "}
                  (abone olmayan ve bastırılmış adresler hariç)
                </span>
              </>
            )}
          </p>
        </Section>

        <Section title="5. İzleme ve UTM">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.trackOpens}
              onChange={(e) => set("trackOpens", e.target.checked)}
            />
            Açılmaları izle
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.trackClicks}
              onChange={(e) => set("trackClicks", e.target.checked)}
            />
            Tıklamaları izle
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.utm.enabled}
              onChange={(e) => setUtm({ enabled: e.target.checked })}
            />
            Bağlantılara UTM parametreleri ekle
          </label>
          {form.utm.enabled ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="u-source" label="utm_source">
                <Input
                  value={form.utm.source}
                  onChange={(e) => setUtm({ source: slugifyUtm(e.target.value) })}
                />
              </Field>
              <Field id="u-medium" label="utm_medium">
                <Input
                  value={form.utm.medium}
                  onChange={(e) => setUtm({ medium: slugifyUtm(e.target.value) })}
                />
              </Field>
              <Field id="u-campaign" label="utm_campaign">
                <Input
                  value={form.utm.campaign}
                  onChange={(e) => setUtm({ campaign: slugifyUtm(e.target.value) })}
                />
              </Field>
            </div>
          ) : null}
        </Section>
      </div>

      <aside
        aria-label="Gönderim hazırlığı"
        className="flex h-fit flex-col gap-4 rounded-lg border bg-surface p-4 lg:sticky lg:top-4"
      >
        <h2 className="text-sm font-semibold">Gönderim hazırlığı</h2>
        {props.issues.length === 0 && !dirty ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Her şey hazır.
          </p>
        ) : null}
        <ul className="flex flex-col gap-2 text-sm">
          {blockers.map((i) => (
            <li key={i.code} className="flex gap-2">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-danger"
                aria-hidden="true"
              />
              <span>{i.message}</span>
            </li>
          ))}
          {warnings.map((i) => (
            <li key={i.code} className="flex gap-2 text-muted-foreground">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden="true"
              />
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
        {dirty ? (
          <p className="text-xs text-muted-foreground">
            Kaydedilmemiş değişiklikler var; hazırlık durumu kayıttan sonra güncellenir.
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs text-success">
            {notice}
          </p>
        ) : null}

        <HealthPanel
          score={props.health.score}
          band={props.health.band}
          findings={props.health.findings}
        />
        <SubjectAssistant
          campaignId={campaign.id}
          ai={props.ai}
          disabled={dirty || !form.templateId}
          onPick={(subject, preheader) => {
            set("subject", subject);
            if (preheader) set("preheader", preheader);
          }}
        />
        <SamplesReview campaignId={campaign.id} disabled={dirty || !form.templateId} />
        <Button onClick={save} disabled={!dirty || busy !== null}>
          {busy === "save" ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <div className="flex gap-2">
          <PreviewButton
            campaignId={campaign.id}
            disabled={dirty || !form.templateId}
          />
          <TestSendButton
            campaignId={campaign.id}
            recipients={props.testRecipients}
            disabled={dirty || !form.templateId}
          />
        </div>

        {props.canSend ? (
          <fieldset className="flex flex-col gap-2 border-t pt-4">
            <legend className="text-sm font-semibold">Gönderim zamanı</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="when"
                checked={sendMode === "now"}
                onChange={() => setSendMode("now")}
              />
              Hemen
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="when"
                checked={sendMode === "later"}
                onChange={() => setSendMode("later")}
              />
              İleri bir tarihte
            </label>
            {sendMode === "later" ? (
              <Input
                type="datetime-local"
                aria-label="Gönderim tarihi ve saati"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
              />
            ) : null}
            {props.requireApproval ? (
              <Button onClick={() => act("submit")} disabled={!ready || busy !== null}>
                {busy === "submit" ? "Gönderiliyor…" : "Onaya gönder"}
              </Button>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button disabled={!ready || busy !== null}>
                    {sendMode === "now" ? "Gönder" : "Zamanla"}
                  </Button>
                }
                title={
                  sendMode === "now"
                    ? "Kampanya gönderilsin mi?"
                    : "Kampanya zamanlansın mı?"
                }
                description={`${props.audienceCount.toLocaleString("tr-TR")} alıcıya gönderilecek. Gönderime alındıktan sonra içerik değiştirilemez; zamanlanmış bir kampanyayı taslağa geri çekebilirsiniz.`}
                confirmLabel={sendMode === "now" ? "Gönder" : "Zamanla"}
                onConfirm={() => act("schedule")}
              />
            )}
            {props.requireApproval ? (
              <p className="text-xs text-muted-foreground">
                Bu çalışma alanında kampanyalar bir yönetici tarafından onaylanmalıdır.
              </p>
            ) : null}
          </fieldset>
        ) : (
          <p className="border-t pt-4 text-xs text-muted-foreground">
            Gönderme yetkiniz yok; kampanyayı hazırlayıp yetkili biriyle paylaşın.
          </p>
        )}
      </aside>
    </div>
  );
}

type Sample = {
  contactId: string;
  email: string;
  name: string;
  reasons: string[];
  subject: string;
  excerpt: string;
  issues: { code: string; message: string }[];
};

/** Pre-send review: the campaign as it will look for real, awkward contacts from the audience. */
function SamplesReview({
  campaignId,
  disabled,
}: {
  campaignId: string;
  disabled: boolean;
}) {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setBusy(true);
    setError(null);
    const r = await apiCall(`/api/campaigns/${campaignId}/samples`, "GET");
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setSamples((r.data as { samples: Sample[] }).samples);
  }
  const bad = samples?.filter((s) => s.issues.length > 0).length ?? 0;
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-semibold">Gerçek kişilerle ön otopsi</h3>
      <p className="text-xs text-muted-foreground">
        Hedef kitlenizden zorlayıcı örnekleri (adı boş, büyük harfli, çok uzun…) seçip
        e-postanın onlarda nasıl görüneceğini kontrol eder. Hiçbir şey gönderilmez.
      </p>
      <Button variant="secondary" onClick={load} disabled={disabled || busy}>
        {busy ? "İnceleniyor…" : samples ? "Yeniden incele" : "Örnekleri incele"}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {samples ? (
        <>
          <p
            role="status"
            className={`text-sm font-medium ${bad ? "text-warning-text" : "text-success"}`}
          >
            {samples.length === 0
              ? "İncelenecek abone bulunamadı."
              : bad
                ? `${samples.length} örnekten ${bad} tanesinde sorun var.`
                : `${samples.length} örnekte sorun bulunmadı.`}
          </p>
          <ul className="flex flex-col gap-2">
            {samples.map((s) => (
              <li key={s.contactId} className="rounded border p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium">{s.name || s.email}</span>
                  <span className="text-muted-foreground">{s.reasons.join(" · ")}</span>
                </div>
                <div className="mt-1">
                  <span className="text-muted-foreground">Konu: </span>
                  {s.subject || "—"}
                </div>
                <div className="truncate text-muted-foreground">{s.excerpt}</div>
                {s.issues.map((i) => (
                  <div
                    key={i.code + i.message}
                    className="mt-1 flex gap-1 text-warning-text"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3 shrink-0"
                      aria-hidden="true"
                    />
                    {i.message}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-surface p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function PreviewButton({
  campaignId,
  disabled,
}: {
  campaignId: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={async () => {
          setOpen(true);
          setHtml(null);
          setError(null);
          const r = await apiCall(`/api/campaigns/${campaignId}/preview`, "GET");
          if (r.ok) setHtml((r.data as { html: string }).html);
          else setError(r.message);
        }}
      >
        Önizle
      </Button>
      <DialogContent
        title="Önizleme"
        description="Gönderilecek e-postanın örnek bir kişiyle üretilmiş hali."
        className="max-w-3xl"
      >
        <FormError message={error} />
        {html ? (
          <iframe
            title="E-posta önizlemesi"
            sandbox=""
            srcDoc={html}
            className="mt-4 h-[65vh] w-full rounded border bg-white"
          />
        ) : error ? null : (
          <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestSendButton({
  campaignId,
  recipients,
  disabled,
}: {
  campaignId: string;
  recipients: EditorProps["testRecipients"];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(
    recipients.filter((r) => r.self).map((r) => r.email),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setMessage(null);
      }}
    >
      <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        Test gönder
      </Button>
      <DialogContent
        title="Test e-postası"
        description="Yalnızca çalışma alanı üyelerine gönderilir. Konu satırına [TEST] eklenir."
      >
        <div className="mt-4 flex flex-col gap-2">
          {recipients.map((r) => (
            <label key={r.email} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(r.email)}
                onChange={(e) =>
                  setPicked((p) =>
                    e.target.checked ? [...p, r.email] : p.filter((x) => x !== r.email),
                  )
                }
              />
              {r.name ? `${r.name} · ` : ""}
              {r.email}
              {r.self ? <Badge tone="info">Siz</Badge> : null}
            </label>
          ))}
        </div>
        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={`mt-3 text-sm ${message.ok ? "text-success" : "text-danger"}`}
          >
            {message.text}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end">
          <Button
            disabled={pending || picked.length === 0}
            onClick={async () => {
              setPending(true);
              const r = await apiCall(`/api/campaigns/${campaignId}/test`, "POST", {
                recipients: picked.slice(0, 5),
              });
              setPending(false);
              setMessage(
                r.ok
                  ? {
                      ok: true,
                      text: `${(r.data as { sent: number }).sent} test e-postası gönderildi.`,
                    }
                  : { ok: false, text: r.message },
              );
            }}
          >
            {pending ? "Gönderiliyor…" : "Gönder"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
