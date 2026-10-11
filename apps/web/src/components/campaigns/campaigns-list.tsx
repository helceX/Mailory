"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, Plus } from "lucide-react";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_PLAYBOOKS,
  type CampaignPlaybookKind,
  type CampaignStatus,
} from "@mailory/core/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Textarea,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";
import { STATUS_TONE, formatWhen } from "./labels";

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  updatedAt: string;
};

export function NewCampaignButton({
  canWrite,
  initialPlaybook,
}: {
  canWrite: boolean;
  initialPlaybook?: CampaignPlaybookKind;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initialPlaybook));
  const [playbook, setPlaybook] = useState<CampaignPlaybookKind | "">(
    initialPlaybook ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canWrite) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" /> Yeni kampanya
      </Button>
      <DialogContent
        title="Yeni kampanya"
        description="Boş taslakla veya hedefinize uygun bir başlangıçla ilerleyin. Gönderim öncesinde içeriği ve kitleyi kontrol edersiniz."
      >
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const name = String(fields.get("name") ?? "");
            setPending(true);
            setError(null);
            const result = await apiCall("/api/campaigns", "POST", {
              name,
              ...(playbook
                ? {
                    playbook: {
                      kind: playbook,
                      proposition: String(fields.get("proposition") ?? ""),
                      actionUrl: String(fields.get("actionUrl") ?? ""),
                      measureImpact: fields.get("measureImpact") === "on",
                    },
                  }
                : {}),
            });
            if (!result.ok) {
              setPending(false);
              return setError(result.message);
            }
            router.push(`/campaigns/${(result.data as { id: string }).id}`);
          }}
        >
          <FormError message={error} />
          <Field
            id="nc-name"
            label="Kampanya adı"
            hint="Yalnızca sizin göreceğiniz iç ad."
          >
            <Input
              name="name"
              required
              maxLength={120}
              autoFocus
              placeholder="Yaz kampanyası"
            />
          </Field>
          <Field id="nc-playbook" label="Kampanyanın amacı">
            <NativeSelect
              value={playbook}
              onChange={(e) => setPlaybook(e.target.value as CampaignPlaybookKind | "")}
            >
              <option value="">Boş taslak</option>
              {Object.entries(CAMPAIGN_PLAYBOOKS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {playbook ? (
            <>
              <p className="text-sm text-muted-foreground">
                {CAMPAIGN_PLAYBOOKS[playbook].description} Konu, düzenlenebilir şablon
                ve tek bir eylem düğmesi hazırlanır. Uygun aboneler başlangıç
                kitlesidir; göndermeden önce seçimi gözden geçirin.
              </p>
              <Field
                id="nc-proposition"
                label="Alıcıya sunduğunuz fayda"
                hint="Gerçek teklifinizi ve alıcıya sağlayacağı faydayı yazın."
              >
                <Textarea
                  name="proposition"
                  minLength={10}
                  maxLength={1000}
                  required
                  placeholder="Örneğin: Ekibinizin teklif hazırlama süresini azaltan ürünü birlikte inceleyelim."
                />
              </Field>
              <Field
                id="nc-url"
                label="Eylem bağlantısı"
                hint="Satın alma, görüşme veya geri dönüş sayfanızın HTTPS adresi."
              >
                <Input
                  name="actionUrl"
                  type="url"
                  pattern="https://.*"
                  maxLength={2048}
                  required
                  placeholder="https://siteniz.com/gorusme"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input name="measureImpact" type="checkbox" /> Etki Motoru ile
                karşılaştırma yap (%50 kontrol, 7 gün)
              </label>
              <p className="text-xs text-muted-foreground">
                Hedef olay: {CAMPAIGN_PLAYBOOKS[playbook].goal}. Etki ölçümü için iki
                grubun tüm hedef olaylarını bağlamalısınız. Kontrol grubuna kampanya
                gönderilmez; az veride sonuç belirsiz kalır.
              </p>
            </>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Oluşturuluyor…" : "Oluştur"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignsTable({
  rows,
  canWrite,
}: {
  rows: CampaignRow[];
  canWrite: boolean;
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon={<Mail className="size-6" aria-hidden="true" />}
        title="Bu görünümde kampanya yok."
        description={
          canWrite
            ? "İlk kampanyanızı oluşturun: şablonunuzu ve kitlenizi seçin, test gönderin, zamanlayın."
            : "Kampanyaları düzenleme yetkisine sahip biri oluşturduğunda burada görünür."
        }
      />
    );
  return (
    <TableContainer>
      <Table>
        <THead>
          <tr>
            <TH>Kampanya</TH>
            <TH>Durum</TH>
            <TH>Gönderim</TH>
            <TH>Güncellendi</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD>
                <Link
                  href={`/campaigns/${r.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {r.name}
                </Link>
                <div className="max-w-md truncate text-xs text-muted-foreground">
                  {r.subject || "Konu henüz yazılmadı"}
                </div>
              </TD>
              <TD>
                <Badge tone={STATUS_TONE[r.status]}>
                  {CAMPAIGN_STATUS_LABELS[r.status]}
                </Badge>
              </TD>
              <TD>{formatWhen(r.scheduledAt)}</TD>
              <TD>{formatWhen(r.updatedAt)}</TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}

export function ApprovalPolicy({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="policy"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface p-4"
    >
      <div>
        <h2 id="policy" className="text-sm font-semibold">
          Onay politikası
        </h2>
        <p className="text-xs text-muted-foreground">
          Açıkken kampanyalar önce onaya gönderilir; gönderen kişi dışında bir yönetici
          onaylayınca zamanlanır. Çalışma alanında en az iki yönetici/sahip olmalıdır.
        </p>
        <FormError message={error} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value}
          onChange={async (e) => {
            const next = e.target.checked;
            setValue(next);
            const r = await apiCall("/api/campaign-policy", "PUT", {
              requireApproval: next,
            });
            if (!r.ok) {
              setValue(!next);
              return setError(r.message);
            }
            setError(null);
            router.refresh();
          }}
        />
        Kampanyalar için onay gereksin
      </label>
    </section>
  );
}

/** Fatigue shield: no contact gets more than N campaign emails per rolling week, however many campaigns are running. */
export function FrequencyCapPolicy({ initial }: { initial: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    setSaved(false);
    const n = value.trim() === "" ? null : Number(value);
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 50))
      return setError("1 ile 50 arasında bir sayı girin ya da boş bırakın.");
    const r = await apiCall("/api/campaign-policy", "PUT", { weeklyCap: n });
    if (!r.ok) return setError(r.message);
    setError(null);
    setSaved(true);
    router.refresh();
  }
  return (
    <section
      aria-labelledby="cap"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface p-4"
    >
      <div>
        <h2 id="cap" className="text-sm font-semibold">
          Yorgunluk kalkanı
        </h2>
        <p className="text-xs text-muted-foreground">
          Bir kişiye 7 günde gönderilecek en fazla kampanya e-postası. Sınıra ulaşan
          kişi bu kampanyada atlanır (raporda “sıklık sınırı” olarak görünür). Otomasyon
          e-postaları atlanmaz ama sayıma dahildir. Boş = sınırsız.
        </p>
        <FormError message={error} />
        {saved ? (
          <p role="status" className="text-xs">
            Kaydedildi.
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="cap-input">Haftalık en fazla</label>
        <input
          id="cap-input"
          inputMode="numeric"
          className="h-9 w-20 rounded border bg-surface px-2"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="∞"
        />
        <button type="button" className="h-9 rounded border px-3" onClick={save}>
          Kaydet
        </button>
      </div>
    </section>
  );
}
