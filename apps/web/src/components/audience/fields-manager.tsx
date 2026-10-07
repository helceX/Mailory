"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
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
import { apiCall, FIELD_TYPE_LABELS } from "./labels";

type FieldRow = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
};

export function FieldsManager({
  fields,
  canWrite,
}: {
  fields: FieldRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState("text");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const options = String(data.get("options") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    setPending(true);
    setError(null);
    const result = await apiCall("/api/contact-fields", "POST", {
      key: String(data.get("key") ?? ""),
      label: String(data.get("label") ?? ""),
      type,
      ...(type === "select" ? { options } : {}),
    });
    setPending(false);
    if (!result.ok) return setError(result.message);
    form.reset();
    setType("text");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <form
          onSubmit={create}
          className="grid gap-3 rounded-lg border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_1fr_auto] lg:items-end"
        >
          <Field id="f-label" label="Alan adı" required>
            <Input name="label" required maxLength={60} placeholder="Yatırım turu" />
          </Field>
          <Field id="f-key" label="Anahtar" hint="küçük_harf_ve_alt_çizgi" required>
            <Input
              name="key"
              required
              maxLength={40}
              placeholder="yatirim_turu"
              pattern="[a-z][a-z0-9_]{0,39}"
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="f-type" className="text-sm font-medium">
              Tür
            </label>
            <NativeSelect
              id="f-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          {type === "select" ? (
            <Field id="f-options" label="Seçenekler" hint="Virgülle ayırın" required>
              <Input name="options" required placeholder="Seed, Seri A" />
            </Field>
          ) : (
            <div className="hidden lg:block" />
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Ekleniyor…" : "Alan ekle"}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Henüz özel alan yok. Ad, şirket gibi hazır alanların dışında kendi
          alanlarınızı (ör. “Yatırım turu”) tanımlayabilirsiniz.
        </p>
      ) : (
        <TableContainer>
          <Table className="min-w-[520px]">
            <THead>
              <tr>
                <TH>Alan</TH>
                <TH>Anahtar</TH>
                <TH>Tür</TH>
                {canWrite ? (
                  <TH>
                    <span className="sr-only">İşlemler</span>
                  </TH>
                ) : null}
              </tr>
            </THead>
            <TBody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <TD className="font-medium">{f.label}</TD>
                  <TD>
                    <code className="text-xs text-muted-foreground">{f.key}</code>
                  </TD>
                  <TD>
                    <Badge>{FIELD_TYPE_LABELS[f.type] ?? f.type}</Badge>
                    {f.options?.length ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {f.options.join(", ")}
                      </span>
                    ) : null}
                  </TD>
                  {canWrite ? (
                    <TD className="text-right">
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Sil
                          </Button>
                        }
                        title={`“${f.label}” alanı silinsin mi?`}
                        description="Alan ve tüm kişilerdeki bu alana ait değerler kalıcı olarak silinir."
                        confirmLabel="Alanı sil"
                        onConfirm={async () => {
                          const result = await apiCall(
                            `/api/contact-fields/${f.id}`,
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
    </div>
  );
}
