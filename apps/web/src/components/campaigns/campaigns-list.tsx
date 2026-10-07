"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, Plus } from "lucide-react";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "@mailory/core/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
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

export function NewCampaignButton({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        description="Önce bir ad verin; konu, şablon ve kitleyi bir sonraki adımda seçersiniz."
      >
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("name") ?? "");
            setPending(true);
            setError(null);
            const result = await apiCall("/api/campaigns", "POST", { name });
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
