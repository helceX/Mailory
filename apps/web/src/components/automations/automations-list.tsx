"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Workflow } from "lucide-react";
import {
  AUTOMATION_STATUS_LABELS,
  TRIGGER_LABELS,
  type AutomationStatus,
  type AutomationTrigger,
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
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

type Opt = { id: string; name: string };
export type AutomationRow = {
  id: string;
  name: string;
  status: AutomationStatus;
  trigger: AutomationTrigger;
  active: number;
  completed: number;
  exited: number;
};
const TONE = {
  draft: "neutral",
  active: "success",
  paused: "warning",
  archived: "neutral",
} as const;

export function NewAutomationButton({
  canWrite,
  lists,
  tags,
}: {
  canWrite: boolean;
  lists: Opt[];
  tags: Opt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AutomationTrigger["type"]>("contact_created");
  const [ref, setRef] = useState("");
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
        <Plus className="size-4" aria-hidden="true" /> Yeni otomasyon
      </Button>
      <DialogContent
        title="Yeni otomasyon"
        description="Ne zaman başlayacağını seçin; adımları bir sonraki ekranda eklersiniz."
      >
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "");
            const trigger: AutomationTrigger =
              kind === "list_joined"
                ? { type: kind, listId: ref }
                : kind === "tag_added"
                  ? { type: kind, tagId: ref }
                  : ({ type: kind } as AutomationTrigger);
            setPending(true);
            setError(null);
            const r = await apiCall("/api/automations", "POST", { name, trigger });
            if (!r.ok) {
              setPending(false);
              return setError(r.message);
            }
            router.push(`/automations/${(r.data as { id: string }).id}`);
          }}
        >
          <FormError message={error} />
          <Field id="na-name" label="Ad">
            <Input
              name="name"
              required
              maxLength={120}
              autoFocus
              placeholder="Karşılama serisi"
            />
          </Field>
          <Field id="na-trigger" label="Tetikleyici">
            <NativeSelect
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AutomationTrigger["type"]);
                setRef("");
              }}
            >
              {(Object.keys(TRIGGER_LABELS) as AutomationTrigger["type"][]).map((k) => (
                <option key={k} value={k}>
                  {TRIGGER_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {kind === "list_joined" || kind === "tag_added" ? (
            <Field id="na-ref" label={kind === "list_joined" ? "Liste" : "Etiket"}>
              <NativeSelect
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                required
              >
                <option value="">Seçin…</option>
                {(kind === "list_joined" ? lists : tags).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Otomasyon yalnızca <strong>başlatıldıktan sonra</strong> tetiklenen kişiler
            için çalışır; mevcut listenize toplu e-posta gitmez.
          </p>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                pending || ((kind === "list_joined" || kind === "tag_added") && !ref)
              }
            >
              {pending ? "Oluşturuluyor…" : "Oluştur"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationsTable({
  rows,
  canWrite,
}: {
  rows: AutomationRow[];
  canWrite: boolean;
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon={<Workflow className="size-6" aria-hidden="true" />}
        title="Henüz otomasyonunuz yok."
        description={
          canWrite
            ? "Yeni kayıt olanlara karşılama serisi gibi, kendiliğinden çalışan e-posta akışları kurun."
            : "Otomasyonları düzenleme yetkisine sahip biri oluşturduğunda burada görünür."
        }
      />
    );
  return (
    <TableContainer>
      <Table>
        <THead>
          <tr>
            <TH>Otomasyon</TH>
            <TH>Durum</TH>
            <TH>Tetikleyici</TH>
            <TH>Akışta</TH>
            <TH>Tamamlayan</TH>
            <TH>Çıkan</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD>
                <Link
                  href={`/automations/${r.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {r.name}
                </Link>
              </TD>
              <TD>
                <Badge tone={TONE[r.status]}>
                  {AUTOMATION_STATUS_LABELS[r.status]}
                </Badge>
              </TD>
              <TD>{TRIGGER_LABELS[r.trigger.type]}</TD>
              <TD>{r.active}</TD>
              <TD>{r.completed}</TD>
              <TD>{r.exited}</TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}
