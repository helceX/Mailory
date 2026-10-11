"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "@mailory/core/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Field,
  Textarea,
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";
import { STATUS_TONE, formatWhen } from "./labels";

export type StatusPanelProps = {
  campaign: {
    id: string;
    name: string;
    subject: string;
    status: CampaignStatus;
    scheduledAt: string | null;
    submittedAt: string | null;
    approvedAt: string | null;
    submittedByUserId: string | null;
    haltReason: string | null;
  };
  progress: Record<string, number> | null;
  snapshot: {
    audienceCount: number;
    version: number;
    sender: { fromName: string; fromEmail: string };
  } | null;
  userId: string;
  canWrite: boolean;
  canSend: boolean;
  canApprove: boolean;
};

export function CampaignStatusPanel(p: StatusPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { campaign: c } = p;

  async function post(
    action: string,
    body?: unknown,
    redirect?: (d: unknown) => string,
  ) {
    setError(null);
    const r = await apiCall(`/api/campaigns/${c.id}/${action}`, "POST", body);
    if (!r.ok) return setError(r.message);
    if (redirect) router.push(redirect(r.data));
    else router.refresh();
  }

  const own = c.submittedByUserId === p.userId;
  // Live progress while the engine is working.
  useEffect(() => {
    if (c.status !== "sending" && c.status !== "scheduled") return;
    const t = setInterval(
      () => router.refresh(),
      c.status === "sending" ? 5000 : 10_000,
    );
    return () => clearInterval(t);
  }, [c.status, router]);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={STATUS_TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
          {c.scheduledAt ? (
            <span className="text-sm text-muted-foreground">
              Gönderim: {formatWhen(c.scheduledAt)}
            </span>
          ) : null}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Konu</dt>
            <dd className="font-medium">{c.subject}</dd>
          </div>
          {p.snapshot ? (
            <>
              <div>
                <dt className="text-muted-foreground">Gönderici</dt>
                <dd className="font-medium">
                  {p.snapshot.sender.fromName} &lt;{p.snapshot.sender.fromEmail}&gt;
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Alıcı sayısı (gönderime alındığında)
                </dt>
                <dd className="font-medium">
                  {p.snapshot.audienceCount.toLocaleString("tr-TR")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Şablon sürümü</dt>
                <dd className="font-medium">v{p.snapshot.version}</dd>
              </div>
            </>
          ) : null}
          {c.submittedAt ? (
            <div>
              <dt className="text-muted-foreground">Onaya gönderildi</dt>
              <dd className="font-medium">{formatWhen(c.submittedAt)}</dd>
            </div>
          ) : null}
          {c.approvedAt ? (
            <div>
              <dt className="text-muted-foreground">Onaylandı</dt>
              <dd className="font-medium">{formatWhen(c.approvedAt)}</dd>
            </div>
          ) : null}
        </dl>
        {p.progress && Object.keys(p.progress).length > 0 ? (
          <Progress counts={p.progress} />
        ) : null}
        {c.haltReason ? (
          <p
            role="status"
            className="rounded border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            {HALT_TEXT[c.haltReason] ?? `Durduruldu: ${c.haltReason}`}
          </p>
        ) : null}
        {c.status === "pending_approval" ? (
          <p className="text-sm text-muted-foreground">
            {own
              ? "Kendi gönderdiğiniz kampanyayı başka bir yönetici onaylamalıdır."
              : "Bu kampanya onayınızı bekliyor."}
          </p>
        ) : null}
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          {c.status === "pending_approval" && p.canApprove && !own ? (
            <>
              <Button onClick={() => post("approve")}>Onayla</Button>
              <RejectButton onReject={(reason) => post("reject", { reason })} />
            </>
          ) : null}
          {(c.status === "pending_approval" || c.status === "scheduled") &&
          p.canSend ? (
            <Button variant="secondary" onClick={() => post("withdraw")}>
              Taslağa geri çek
            </Button>
          ) : null}
          {["pending_approval", "scheduled", "sending", "paused"].includes(c.status) &&
          p.canSend ? (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" className="text-danger">
                  İptal et
                </Button>
              }
              title="Kampanya iptal edilsin mi?"
              description="İptal geri alınamaz. Gönderim başlamışsa kalan alıcılara gönderilmez."
              confirmLabel="İptal et"
              onConfirm={() => post("cancel")}
            />
          ) : null}
          {p.canWrite ? (
            <Button
              variant="secondary"
              onClick={() =>
                post(
                  "duplicate",
                  undefined,
                  (d) => `/campaigns/${(d as { id: string }).id}`,
                )
              }
            >
              Çoğalt
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/campaigns">Kampanyalara dön</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function RejectButton({ onReject }: { onReject: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Reddet
      </Button>
      <DialogContent
        title="Kampanya reddedilsin mi?"
        description="Kampanya taslağa döner; gerekçeniz gönderenle paylaşılır."
      >
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await onReject(reason);
            setOpen(false);
          }}
        >
          <Field id="rej" label="Gerekçe">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={500}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={!reason.trim()}>
              Reddet
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const HALT_TEXT: Record<string, string> = {
  manual: "Kampanya duraklatıldı.",
  daily_limit:
    "Günlük gönderim sınırına ulaşıldı. Sınır yenilendiğinde (UTC gün başı) otomatik devam eder.",
  sender_unverified:
    "Göndericinin alan adı artık doğrulanmış görünmüyor. Alan adı ayarlarını düzeltip devam ettirin.",
  bounce_rate:
    "Geri dönen (bounce) oranı güvenli sınırı aştı; alan adı itibarınızı korumak için otomatik duraklatıldı. Listenizi temizleyip devam ettirin.",
  complaint_rate:
    "Şikayet oranı güvenli sınırı aştı; otomatik duraklatıldı. Kitlenizi ve izin kayıtlarınızı gözden geçirin.",
  audience_missing: "Kitle (liste/segment/etiket) bulunamadı.",
  missing_snapshot: "Kampanya içeriği eksik.",
};

const PROGRESS_LABELS: [string, string][] = [
  ["queued", "Sırada"],
  ["sending", "Gönderiliyor"],
  ["sent", "Gönderildi"],
  ["delivered", "Teslim edildi"],
  ["bounced", "Geri döndü"],
  ["complained", "Şikayet"],
  ["failed", "Başarısız"],
  ["skipped", "Atlandı"],
];

function Progress({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = total - (counts.queued ?? 0) - (counts.sending ?? 0);
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="text-sm">
        <strong>{done.toLocaleString("tr-TR")}</strong> /{" "}
        {total.toLocaleString("tr-TR")} alıcı işlendi
      </div>
      <div
        className="h-2 overflow-hidden rounded bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div
          className="h-full bg-primary"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {PROGRESS_LABELS.filter(([k]) => counts[k]).map(([k, label]) => (
          <div key={k}>
            <dt className="inline">{label}: </dt>
            <dd className="inline font-medium text-foreground">
              {counts[k]!.toLocaleString("tr-TR")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
