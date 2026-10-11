"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
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
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall, STATUS_LABELS, STATUS_TONES } from "./labels";

const MEMBERSHIP_ACTIONS = ["add_to_list", "remove_from_list", "add_tag", "remove_tag"];

type Row = {
  id: string;
  email: string;
  name: string;
  company: string | null;
  status: string;
  createdAt: string;
  tags: { id: string; name: string }[];
};
type Opt = { id: string; name: string };
type Filter = {
  q?: string;
  status?: string;
  listId?: string;
  tagId?: string;
  segmentId?: string;
  consentStatus?: string;
};

export function ContactsView({
  initial,
  filter,
  queryString,
  options,
  canWrite,
  canExport,
}: {
  initial: { rows: Row[]; nextCursor: string | null; total: number };
  filter: Filter;
  queryString: string;
  options: { lists: Opt[]; tags: Opt[]; segments: Opt[] };
  canWrite: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.rows);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(
    null,
  );

  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectionCount = allMatching ? initial.total : selected.size;
  const target = useMemo(
    () => (allMatching ? { filter } : { ids: [...selected].slice(0, 1000) }),
    [allMatching, filter, selected],
  );

  function applyFilter(next: Filter) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    router.replace(`/audience/contacts${params.size ? `?${params}` : ""}`);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const params = new URLSearchParams(queryString);
    params.set("cursor", cursor);
    params.set("limit", "50");
    const result = await apiCall(`/api/contacts?${params}`, "GET");
    setLoading(false);
    if (!result.ok) return setMessage({ tone: "error", text: result.message });
    const data = result.data as {
      contacts: Array<
        Omit<Row, "name" | "createdAt"> & {
          firstName: string | null;
          lastName: string | null;
          createdAt: string;
        }
      >;
      nextCursor: string | null;
    };
    setRows((current) => [
      ...current,
      ...data.contacts.map((c) => ({
        id: c.id,
        email: c.email,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        company: c.company,
        status: c.status,
        createdAt: c.createdAt,
        tags: c.tags,
      })),
    ]);
    setCursor(data.nextCursor);
  }

  async function bulk(body: Record<string, unknown>, success: string) {
    setMessage(null);
    const result = await apiCall("/api/contacts/bulk", "POST", { ...target, ...body });
    if (!result.ok) return setMessage({ tone: "error", text: result.message });
    const affected = (result.data as { affected: number }).affected;
    setMessage({
      tone: "ok",
      // 0 affected is not a failure for membership actions: everyone was already in (or out of) the group.
      text:
        affected === 0 && MEMBERSHIP_ACTIONS.includes(String(body.action))
          ? "Değişiklik yok: seçili kişiler zaten bu durumda."
          : `${success} (${affected.toLocaleString("tr-TR")} kişi)`,
    });
    setSelected(new Set());
    setAllMatching(false);
    router.refresh();
  }

  const exportHref = `/api/contacts/export${queryString ? `?${queryString}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          applyFilter({
            ...filter,
            q: String(form.get("q") ?? "").trim() || undefined,
          });
        }}
      >
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
            Ara
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filter.q ?? ""}
            placeholder="E-posta, ad veya şirket"
            className="h-9 rounded border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        {(
          [
            [
              "status",
              "Durum",
              Object.entries(STATUS_LABELS).map(([id, name]) => ({ id, name })),
            ],
            ["listId", "Liste", options.lists],
            ["tagId", "Etiket", options.tags],
            ["segmentId", "Segment", options.segments],
          ] as const
        ).map(([key, label, opts]) => (
          <div key={key} className="flex flex-col gap-1">
            <label
              htmlFor={`f-${key}`}
              className="text-xs font-medium text-muted-foreground"
            >
              {label}
            </label>
            <NativeSelect
              id={`f-${key}`}
              value={filter[key] ?? ""}
              onChange={(e) =>
                applyFilter({ ...filter, [key]: e.target.value || undefined })
              }
            >
              <option value="">Tümü</option>
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
        <Button type="submit" variant="secondary">
          Ara
        </Button>
        {Object.values(filter).some(Boolean) ? (
          <Button type="button" variant="ghost" onClick={() => applyFilter({})}>
            Filtreleri temizle
          </Button>
        ) : null}
        {canExport ? (
          <Button asChild variant="secondary" className="ml-auto">
            <a href={exportHref} download>
              <Download aria-hidden="true" /> CSV dışa aktar
            </a>
          </Button>
        ) : null}
      </form>

      {message ? (
        message.tone === "error" ? (
          <FormError message={message.text} />
        ) : (
          <p
            role="status"
            className="rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
          >
            {message.text}
          </p>
        )
      ) : null}

      {canWrite && selectionCount > 0 ? (
        <div
          role="region"
          aria-label="Toplu işlemler"
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface-muted px-4 py-3 text-sm"
        >
          <span className="font-medium">
            {selectionCount.toLocaleString("tr-TR")} kişi seçili
          </span>
          {!allMatching && allLoadedSelected && initial.total > rows.length ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setAllMatching(true)}
            >
              Eşleşen {initial.total.toLocaleString("tr-TR")} kişinin tümünü seç
            </button>
          ) : null}
          <NativeSelect
            aria-label="Listeye ekle"
            value=""
            onChange={(e) =>
              e.target.value &&
              bulk({ action: "add_to_list", listId: e.target.value }, "Listeye eklendi")
            }
          >
            <option value="">Listeye ekle…</option>
            {options.lists.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Etiket ekle"
            value=""
            onChange={(e) =>
              e.target.value &&
              bulk({ action: "add_tag", tagId: e.target.value }, "Etiket eklendi")
            }
          >
            <option value="">Etiket ekle…</option>
            {options.tags.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Durumu değiştir"
            value=""
            onChange={(e) =>
              e.target.value &&
              bulk(
                { action: "set_status", status: e.target.value },
                "Durum güncellendi",
              )
            }
          >
            <option value="">Durumu değiştir…</option>
            {["unsubscribed", "cleaned"].map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <ConfirmDialog
            trigger={
              <Button variant="danger" size="sm">
                Sil
              </Button>
            }
            title={`${selectionCount.toLocaleString("tr-TR")} kişi silinsin mi?`}
            description="Seçili kişiler kalıcı olarak silinir ve geri alınamaz. Bu işlem denetim kaydına yazılır."
            confirmLabel="Kalıcı olarak sil"
            onConfirm={() => bulk({ action: "delete" }, "Silindi")}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(new Set());
              setAllMatching(false);
            }}
          >
            Seçimi temizle
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Bu filtreyle eşleşen kişi bulunamadı. Filtreleri değiştirmeyi deneyin.
        </p>
      ) : (
        <TableContainer>
          <Table className="min-w-[720px]">
            <THead>
              <tr>
                {canWrite ? (
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Yüklenen tüm kişileri seç"
                      checked={allLoadedSelected}
                      onChange={(e) => {
                        setAllMatching(false);
                        setSelected(
                          e.target.checked ? new Set(rows.map((r) => r.id)) : new Set(),
                        );
                      }}
                    />
                  </TH>
                ) : null}
                <TH>Kişi</TH>
                <TH>Şirket</TH>
                <TH>Durum</TH>
                <TH>Etiketler</TH>
                <TH>Eklenme</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-muted">
                  {canWrite ? (
                    <TD>
                      <input
                        type="checkbox"
                        aria-label={`${r.email} seç`}
                        checked={allMatching || selected.has(r.id)}
                        onChange={(e) => {
                          setAllMatching(false);
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          });
                        }}
                      />
                    </TD>
                  ) : null}
                  <TD>
                    <Link
                      href={`/audience/contacts/${r.id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {r.name || r.email}
                    </Link>
                    {r.name ? (
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    ) : null}
                  </TD>
                  <TD className="text-muted-foreground">{r.company ?? "—"}</TD>
                  <TD>
                    <Badge tone={STATUS_TONES[r.status] ?? "neutral"}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {r.tags.slice(0, 3).map((t) => (
                        <Badge key={t.id}>{t.name}</Badge>
                      ))}
                      {r.tags.length > 3 ? <Badge>+{r.tags.length - 3}</Badge> : null}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("tr-TR")}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span aria-live="polite">
          {rows.length.toLocaleString("tr-TR")} /{" "}
          {initial.total.toLocaleString("tr-TR")} kişi gösteriliyor
        </span>
        {cursor ? (
          <Button variant="secondary" onClick={loadMore} disabled={loading}>
            {loading ? "Yükleniyor…" : "Daha fazla yükle"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
