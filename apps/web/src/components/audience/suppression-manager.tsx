"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  NativeSelect,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  Textarea,
} from "@mailory/ui";
import { FormError, Notice } from "../auth/auth-card";
import { apiCall, REASON_LABELS } from "./labels";

type Row = { id: string; email: string; reason: string; createdAt: string };

export function SuppressionManager({
  rows,
  total,
  page,
  pageSize,
  q,
  canWrite,
  canLift,
}: {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  canWrite: boolean;
  canLift: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) =>
    `/audience/suppression?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const emails = String(data.get("emails") ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    setError(null);
    setNotice(null);
    setPending(true);
    const result = await apiCall("/api/suppressions", "POST", {
      emails,
      reason: String(data.get("reason")),
    });
    setPending(false);
    if (!result.ok) return setError(result.message);
    const r = result.data as { added: number; alreadyPresent: number };
    setNotice(
      `${r.added} adres eklendi${r.alreadyPresent ? `, ${r.alreadyPresent} adres zaten listedeydi` : ""}.`,
    );
    form.reset();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border bg-surface-muted p-4 text-sm text-muted-foreground">
        Bu listedeki adreslere{" "}
        <strong className="text-foreground">hiçbir kampanya gönderilmez</strong>.
        Abonelikten çıkan, kalıcı olarak geri dönen veya şikayet eden adresler otomatik
        eklenir.
        {canLift ? "" : " Listeden çıkarma yalnızca yöneticilere açıktır."}
      </p>
      {canWrite ? (
        <form
          onSubmit={add}
          className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
        >
          <label htmlFor="sup-emails" className="text-sm font-medium">
            Adres ekle
          </label>
          <Textarea
            id="sup-emails"
            name="emails"
            rows={3}
            required
            placeholder="Her satıra veya virgülle ayırarak bir adres"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sup-reason" className="text-sm font-medium">
                Neden
              </label>
              <NativeSelect id="sup-reason" name="reason" defaultValue="manual">
                {["manual", "unsubscribe", "hard_bounce", "complaint"].map((r) => (
                  <option key={r} value={r}>
                    {REASON_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Ekleniyor…" : "Listeye ekle"}
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
      {notice ? <Notice>{notice}</Notice> : null}

      <form role="search" className="flex gap-2" action="/audience/suppression">
        <label htmlFor="sup-q" className="sr-only">
          Adreslerde ara
        </label>
        <input
          id="sup-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Adreslerde ara"
          className="h-9 min-w-[220px] flex-1 rounded border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button type="submit" variant="secondary">
          Ara
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {q
            ? "Aramayla eşleşen adres yok."
            : "Bastırma listeniz boş. Birisi abonelikten çıktığında veya e-posta geri döndüğünde burada görünür."}
        </p>
      ) : (
        <TableContainer>
          <Table className="min-w-[520px]">
            <THead>
              <tr>
                <TH>Adres</TH>
                <TH>Neden</TH>
                <TH>Eklenme</TH>
                {canLift ? (
                  <TH>
                    <span className="sr-only">İşlemler</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <TD className="font-medium">{r.email}</TD>
                  <TD>
                    <Badge>{REASON_LABELS[r.reason] ?? r.reason}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("tr-TR")}
                  </TD>
                  {canLift ? (
                    <TD className="text-right">
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Listeden çıkar
                          </Button>
                        }
                        title="Bu adres listeden çıkarılsın mı?"
                        description={`${r.email} adresine yeniden e-posta gönderilebilir hale gelir. Yalnızca kişi açıkça yeniden izin verdiyse çıkarın. Bu işlem denetim kaydına yazılır.`}
                        confirmLabel="Listeden çıkar"
                        onConfirm={async () => {
                          const result = await apiCall(
                            `/api/suppressions?email=${encodeURIComponent(r.email)}`,
                            "DELETE",
                          );
                          if (!result.ok) setError(result.message);
                          router.refresh();
                        }}
                      />
                    </TD>
                  ) : null}
                </tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
      {pages > 1 ? (
        <nav
          aria-label="Sayfalar"
          className="flex items-center justify-between text-sm"
        >
          <span className="text-muted-foreground tabular-nums">
            Sayfa {page} / {pages} · {total.toLocaleString("tr-TR")} adres
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={href(page - 1)}>Önceki</Link>
              </Button>
            ) : null}
            {page < pages ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={href(page + 1)}>Sonraki</Link>
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
