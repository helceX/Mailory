"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUp } from "lucide-react";
import {
  Button,
  NativeSelect,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@mailory/ui";
import { FormError, Notice } from "../auth/auth-card";
import { apiCall } from "./labels";

type Preview = {
  headers: string[];
  sample: string[][];
  totalRows: number;
  suggestedMapping: Record<string, string>;
  customFields: { key: string; label: string }[];
};
type Result = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  invalid: number;
  suppressed: number;
  errors: { row: number; message: string }[];
};

const TARGETS: [string, string][] = [
  ["email", "E-posta (zorunlu)"],
  ["first_name", "Ad"],
  ["last_name", "Soyad"],
  ["company", "Şirket"],
  ["position", "Pozisyon"],
  ["website", "Web sitesi"],
  ["phone", "Telefon"],
  ["sector", "Sektör"],
  ["city", "Şehir"],
  ["source", "Kaynak"],
];
const MAX_BYTES = 8_000_000;

export function ImportWizard({
  lists,
  tags,
}: {
  lists: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [listId, setListId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_BYTES)
      return setError("Dosya 8 MB sınırını aşıyor. Lütfen daha küçük parçalara bölün.");
    const text = await file.text();
    setBusy(true);
    const response = await apiCall("/api/contacts/import/preview", "POST", {
      csv: text,
    });
    setBusy(false);
    if (!response.ok) return setError(response.message);
    const data = response.data as Preview;
    setCsv(text);
    setFilename(file.name);
    setPreview(data);
    setMapping(data.suggestedMapping);
  }

  const emailMapped = Object.values(mapping).includes("email");

  async function run() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    const response = await apiCall("/api/contacts/import", "POST", {
      csv,
      mapping: clean,
      filename,
      listId: listId || undefined,
      tagIds: tagIds.length ? tagIds : undefined,
      updateExisting,
      consentAttested: attested,
    });
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data as Result);
    router.refresh();
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>İçe aktarma tamamlandı.</Notice>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(
            [
              ["Eklenen", result.inserted],
              ["Güncellenen", result.updated],
              ["Atlanan (zaten kayıtlı / tekrar)", result.skipped],
              ["Geçersiz satır", result.invalid],
              ["Bastırma listesinde", result.suppressed],
              ["Toplam satır", result.total],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-surface p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums">
                {value.toLocaleString("tr-TR")}
              </dd>
            </div>
          ))}
        </dl>
        {result.errors.length ? (
          <section aria-labelledby="err-h" className="rounded-lg border bg-surface p-4">
            <h2 id="err-h" className="text-sm font-semibold">
              Düzeltilmesi gereken satırlar
              {result.invalid > result.errors.length
                ? ` (ilk ${result.errors.length})`
                : ""}
            </h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {result.errors.map((e) => (
                <li key={e.row}>
                  Satır {e.row}: {e.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/audience/contacts">Kişilere git</Link>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              setPreview(null);
              setCsv(null);
              setAttested(false);
            }}
          >
            Başka dosya aktar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <FormError message={error} />
      <section aria-labelledby="step1" className="rounded-lg border bg-surface p-4">
        <h2 id="step1" className="text-sm font-semibold">
          1. Dosyayı seçin
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          CSV dosyası (virgül veya noktalı virgülle ayrılmış, UTF-8). İlk satır sütun
          başlıkları olmalı. En fazla 50.000 satır.
        </p>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded border border-dashed px-4 py-6 text-sm hover:bg-surface-muted focus-within:ring-2 focus-within:ring-primary">
          <FileUp className="size-5 text-muted-foreground" aria-hidden="true" />
          <span>{filename || "CSV dosyası seç"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
            disabled={busy}
          />
        </label>
      </section>

      {preview ? (
        <>
          <section
            aria-labelledby="step2"
            className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
          >
            <h2 id="step2" className="text-sm font-semibold">
              2. Sütunları eşleyin ({preview.totalRows.toLocaleString("tr-TR")} satır)
            </h2>
            <TableContainer>
              <Table className="min-w-[560px]">
                <THead>
                  <tr>
                    <TH>Dosyadaki sütun</TH>
                    <TH>Örnek</TH>
                    <TH>Mailory alanı</TH>
                  </tr>
                </THead>
                <TBody>
                  {preview.headers.map((header, i) => (
                    <tr key={header + i}>
                      <TD className="font-medium">{header}</TD>
                      <TD className="max-w-[220px] truncate text-muted-foreground">
                        {preview.sample
                          .map((r) => r[i])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(", ") || "—"}
                      </TD>
                      <TD>
                        <NativeSelect
                          aria-label={`${header} sütununu eşle`}
                          value={mapping[header] ?? ""}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [header]: e.target.value }))
                          }
                        >
                          <option value="">İçe aktarma</option>
                          {TARGETS.map(([v, l]) => (
                            <option
                              key={v}
                              value={v}
                              disabled={Object.entries(mapping).some(
                                ([h, t]) => t === v && h !== header,
                              )}
                            >
                              {l}
                            </option>
                          ))}
                          {preview.customFields.map((f) => (
                            <option
                              key={f.key}
                              value={`custom:${f.key}`}
                              disabled={Object.entries(mapping).some(
                                ([h, t]) => t === `custom:${f.key}` && h !== header,
                              )}
                            >
                              {f.label} (özel)
                            </option>
                          ))}
                        </NativeSelect>
                      </TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            {!emailMapped ? (
              <p role="alert" className="text-sm text-danger">
                Devam etmek için bir sütunu “E-posta” alanına eşleyin.
              </p>
            ) : null}
          </section>

          <section
            aria-labelledby="step3"
            className="flex flex-col gap-4 rounded-lg border bg-surface p-4"
          >
            <h2 id="step3" className="text-sm font-semibold">
              3. Seçenekler
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="imp-list" className="text-sm font-medium">
                  Listeye ekle (isteğe bağlı)
                </label>
                <NativeSelect
                  id="imp-list"
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                >
                  <option value="">Liste yok</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium">Etiketle (isteğe bağlı)</legend>
                {tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Henüz etiket yok.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {tags.map((t) => (
                      <label key={t.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={tagIds.includes(t.id)}
                          onChange={(e) =>
                            setTagIds((ids) =>
                              e.target.checked
                                ? [...ids, t.id]
                                : ids.filter((x) => x !== t.id),
                            )
                          }
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
              />
              <span>
                Zaten kayıtlı kişilerin boş olmayan bilgilerini güncelle.{" "}
                <span className="text-muted-foreground">
                  (Abonelik ve izin durumları asla değişmez.)
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              <span>
                <strong>İzin beyanı.</strong> Bu dosyadaki kişilerden e-posta
                pazarlaması için gerekli izni (KVKK ve ilgili mevzuat kapsamında)
                aldığımı onaylıyorum. Bu beyan, yükleyen kullanıcı ve zaman bilgisiyle
                kayıt altına alınır. Abonelikten çıkmış veya bastırma listesindeki
                adresler içe aktarılmaz.
              </span>
            </label>
            <div>
              <Button onClick={run} disabled={busy || !emailMapped || !attested}>
                {busy
                  ? "İçe aktarılıyor…"
                  : `${preview.totalRows.toLocaleString("tr-TR")} satırı içe aktar`}
              </Button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
