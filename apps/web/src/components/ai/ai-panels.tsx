"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  Field,
  NativeSelect,
  Textarea,
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

export type AiStatus = { available: boolean; enabled: boolean };

const NOTE =
  "Yapay zekâ önerileri taslaktır; hiçbir şey otomatik gönderilmez veya uygulanmaz. E-posta metni üçüncü taraf bir modele iletilir; kişi bilgileri iletilmez.";

function Off({ ai }: { ai: AiStatus }) {
  return (
    <p className="text-xs text-muted-foreground">
      {ai.available
        ? "Yapay zekâ yardımcısı bu çalışma alanı için kapalı. Bir yönetici Kampanyalar sayfasından açabilir."
        : "Yapay zekâ yardımcısı bu ortamda yapılandırılmamış."}
    </p>
  );
}

export function SubjectAssistant({
  campaignId,
  ai,
  disabled,
  onPick,
}: {
  campaignId: string;
  ai: AiStatus;
  disabled: boolean;
  onPick: (subject: string, preheader: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<{ subject: string; preheader: string }[] | null>(
    null,
  );
  const [review, setReview] = useState<{
    summary: string;
    suggestions: { area: string; text: string; severity: string }[];
  } | null>(null);
  async function call(kind: "subjects" | "review") {
    setBusy(true);
    setError(null);
    const r = await apiCall(`/api/campaigns/${campaignId}/ai/${kind}`, "POST");
    setBusy(false);
    if (!r.ok) return setError(r.message);
    if (kind === "subjects")
      setItems(
        (r.data as { suggestions: { subject: string; preheader: string }[] })
          .suggestions,
      );
    else setReview((r.data as { review: NonNullable<typeof review> }).review);
  }
  return (
    <section
      aria-label="Yapay zekâ yardımcısı"
      className="flex flex-col gap-2 border-t pt-4"
    >
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        <Sparkles className="size-4" aria-hidden="true" /> Yapay zekâ yardımcısı
      </h3>
      {!ai.available || !ai.enabled ? (
        <Off ai={ai} />
      ) : (
        <>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || disabled}
              onClick={() => call("subjects")}
            >
              Konu önerileri
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || disabled}
              onClick={() => call("review")}
            >
              İçerik incelemesi
            </Button>
          </div>
          {disabled ? (
            <p className="text-xs text-muted-foreground">
              Önce kaydedin ve bir şablon seçin.
            </p>
          ) : null}
          <FormError message={error} />
          {busy ? (
            <p className="text-xs text-muted-foreground" role="status">
              Hazırlanıyor…
            </p>
          ) : null}
          {items ? (
            <ul className="flex flex-col gap-1">
              {items.map((s) => (
                <li key={s.subject}>
                  <button
                    type="button"
                    className="w-full rounded border p-2 text-left text-xs hover:bg-secondary"
                    onClick={() => onPick(s.subject, s.preheader)}
                  >
                    <div className="font-medium">{s.subject}</div>
                    {s.preheader ? (
                      <div className="text-muted-foreground">{s.preheader}</div>
                    ) : null}
                    <div className="mt-1 text-[11px] text-primary">Kullan</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {review ? (
            <div className="text-xs">
              <p className="font-medium">{review.summary}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {review.suggestions.map((s) => (
                  <li key={s.text} className="rounded border p-2">
                    <strong>{s.area}:</strong> {s.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">{NOTE}</p>
        </>
      )}
    </section>
  );
}

export function AnalystButton({
  campaignId,
  ai,
}: {
  campaignId: string;
  ai: AiStatus;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{
    summary: string;
    insights: string[];
    nextActions: string[];
  } | null>(null);
  if (!ai.available || !ai.enabled) return null;
  return (
    <section
      aria-label="Yapay zekâ analizi"
      className="flex flex-col gap-2 rounded-lg border bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          <Sparkles className="size-4" aria-hidden="true" /> Sonuçları yorumla
        </h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await apiCall(`/api/campaigns/${campaignId}/ai/analyze`, "POST");
            setBusy(false);
            if (!r.ok) return setError(r.message);
            setOut((r.data as { analysis: NonNullable<typeof out> }).analysis);
          }}
        >
          {busy ? "Analiz ediliyor…" : "Analiz et"}
        </Button>
      </div>
      <FormError message={error} />
      {out ? (
        <div className="text-sm">
          <p>{out.summary}</p>
          {out.insights.length ? (
            <ul className="mt-2 list-disc pl-5">
              {out.insights.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : null}
          {out.nextActions.length ? (
            <>
              <p className="mt-2 font-medium">Sonraki adımlar</p>
              <ul className="list-disc pl-5">
                {out.nextActions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Modele yalnızca toplam sayılar gönderilir. Öneri niteliğindedir.
      </p>
    </section>
  );
}

type Draft = {
  title: string;
  doc: { blocks: { type: string; text?: string; label?: string }[] };
};

export function AiDraftButton({ ai, canWrite }: { ai: AiStatus; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("samimi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (!canWrite || !ai.available) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setError(null);
          setDraft(null);
        }
      }}
    >
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" aria-hidden="true" /> Yapay zekâ ile taslak
      </Button>
      <DialogContent
        title="Yapay zekâ ile taslak"
        description="Ne anlatmak istediğinizi yazın; markanıza uygun bir taslak önerelim. Beğenirseniz şablon olarak kaydedersiniz."
      >
        {!ai.enabled ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Yapay zekâ yardımcısı bu çalışma alanı için kapalı. Bir yönetici Kampanyalar
            sayfasından açabilir.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <Field id="ai-brief" label="Açıklama">
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Örn. Mart sonuna kadar geçerli yüzde 20 indirimi duyuran, samimi bir e-posta"
              />
            </Field>
            <Field id="ai-tone" label="Ton">
              <NativeSelect value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="samimi">Samimi</option>
                <option value="profesyonel">Profesyonel</option>
                <option value="enerjik">Enerjik</option>
                <option value="sade">Sade</option>
              </NativeSelect>
            </Field>
            <FormError message={error} />
            {draft ? (
              <div
                className="rounded border p-3 text-sm"
                aria-label="Taslak önizlemesi"
              >
                <div className="font-semibold">{draft.title}</div>
                <ul className="mt-2 flex flex-col gap-1">
                  {draft.doc.blocks
                    .filter((b) => b.text || b.label)
                    .map((b, i) => (
                      <li key={i} className="text-muted-foreground">
                        {b.type === "button" ? `[Düğme: ${b.label}]` : b.text}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">{NOTE}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={busy || brief.trim().length < 10}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const r = await apiCall("/api/ai/draft", "POST", { brief, tone });
                  setBusy(false);
                  if (!r.ok) return setError(r.message);
                  setDraft(r.data as Draft);
                }}
              >
                {busy ? "Yazılıyor…" : draft ? "Yeniden yaz" : "Taslak oluştur"}
              </Button>
              {draft ? (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await apiCall("/api/ai/draft/save", "POST", {
                      title: draft.title,
                      doc: draft.doc,
                    });
                    setBusy(false);
                    if (!r.ok) return setError(r.message);
                    router.push(`/templates/${(r.data as { id: string }).id}`);
                  }}
                >
                  Şablon olarak kaydet
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AiToggle({
  initial,
  available,
}: {
  initial: boolean;
  available: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="ai-toggle"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface p-4"
    >
      <div>
        <h2 id="ai-toggle" className="text-sm font-semibold">
          Yapay zekâ yardımcısı
        </h2>
        <p className="text-xs text-muted-foreground">
          Konu önerisi, içerik incelemesi, sonuç yorumu ve taslak yazımı. Açıkken
          e-posta <em>metni</em> (kişi bilgisi değil) üçüncü taraf bir yapay zekâ
          sağlayıcısına gönderilir; hiçbir şey otomatik gönderilmez.{" "}
          {available ? "" : "Bu ortamda sağlayıcı yapılandırılmamış."}
        </p>
        <FormError message={error} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={!available}
          onChange={async (e) => {
            const next = e.target.checked;
            setOn(next);
            const r = await apiCall("/api/ai/enabled", "PUT", { enabled: next });
            if (!r.ok) {
              setOn(!next);
              return setError(r.message);
            }
            setError(null);
            router.refresh();
          }}
        />
        Yapay zekâ yardımcısını aç
      </label>
    </section>
  );
}
