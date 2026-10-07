"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ConfirmDialog, Field, Input, NativeSelect } from "@mailory/ui";
import { FormError, Notice } from "../auth/auth-card";
import { apiCall, CONSENT_LABELS, STATUS_LABELS } from "./labels";

type CustomField = {
  key: string;
  label: string;
  type: string;
  options: string[] | null;
};
export type ContactFormValues = {
  id?: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  website: string | null;
  phone: string | null;
  sector: string | null;
  city: string | null;
  status: string;
  consentStatus: string;
  consentSource: string | null;
  consentAt: string | null;
  unsubscribedAt: string | null;
  custom: Record<string, string | number | boolean | null>;
  tags: { id: string; name: string }[];
  lists: { id: string; name: string }[];
};

const TEXT_FIELDS: [keyof ContactFormValues, string][] = [
  ["firstName", "Ad"],
  ["lastName", "Soyad"],
  ["company", "Şirket"],
  ["position", "Pozisyon"],
  ["website", "Web sitesi"],
  ["phone", "Telefon"],
  ["sector", "Sektör"],
  ["city", "Şehir"],
];

export function ContactForm({
  initial,
  fields,
  canWrite,
}: {
  initial?: ContactFormValues;
  fields: CustomField[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const editing = Boolean(initial?.id);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();

    const body: Record<string, unknown> = {
      email: text("email"),
      consentStatus: text("consentStatus"),
    };
    for (const [key] of TEXT_FIELDS) body[key] = text(key as string);
    if (editing) body.status = text("status");
    const custom: Record<string, unknown> = {};
    for (const f of fields)
      custom[f.key] =
        f.type === "boolean" ? text(`custom_${f.key}`) : text(`custom_${f.key}`);
    body.custom = custom;
    if (!editing) body.consentSource = "manual";

    const result = editing
      ? await apiCall(`/api/contacts/${initial!.id}`, "PATCH", body)
      : await apiCall("/api/contacts", "POST", body);
    setPending(false);
    if (!result.ok) return setError(result.message);
    if (!editing)
      return router.replace(`/audience/contacts/${(result.data as { id: string }).id}`);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormError message={error} />
      {saved ? <Notice>Değişiklikler kaydedildi.</Notice> : null}
      <fieldset disabled={!canWrite || pending} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Kişi bilgileri</legend>
        <Field id="email" label="E-posta" required className="sm:col-span-2">
          <Input
            name="email"
            type="email"
            defaultValue={initial?.email}
            required
            autoComplete="off"
          />
        </Field>
        {TEXT_FIELDS.map(([key, label]) => (
          <Field key={key} id={key as string} label={label}>
            <Input
              name={key as string}
              defaultValue={(initial?.[key] as string | null) ?? ""}
            />
          </Field>
        ))}
        {fields.map((f) => {
          const value = initial?.custom[f.key];
          const id = `custom_${f.key}`;
          return (
            <Field key={f.key} id={id} label={f.label}>
              {f.type === "select" ? (
                <NativeSelect
                  name={id}
                  defaultValue={String(value ?? "")}
                  className="w-full"
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </NativeSelect>
              ) : f.type === "boolean" ? (
                <NativeSelect
                  name={id}
                  defaultValue={
                    value === true ? "true" : value === false ? "false" : ""
                  }
                  className="w-full"
                >
                  <option value="">—</option>
                  <option value="true">Evet</option>
                  <option value="false">Hayır</option>
                </NativeSelect>
              ) : (
                <Input
                  name={id}
                  type={
                    f.type === "number" ? "text" : f.type === "date" ? "date" : "text"
                  }
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  defaultValue={
                    value === null || value === undefined ? "" : String(value)
                  }
                />
              )}
            </Field>
          );
        })}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="consentStatus" className="text-sm font-medium">
            İzin durumu
          </label>
          <NativeSelect
            id="consentStatus"
            name="consentStatus"
            defaultValue={initial?.consentStatus ?? "unknown"}
          >
            {Object.entries(CONSENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Pazarlama e-postası göndermek için kişinin izin vermiş olması gerekir.
          </p>
        </div>
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status" className="text-sm font-medium">
              Abonelik durumu
            </label>
            <NativeSelect id="status" name="status" defaultValue={initial!.status}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </fieldset>

      {editing ? (
        <dl className="grid gap-3 rounded-lg border bg-surface-muted p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">İzin kaynağı</dt>
            <dd>{initial!.consentSource ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">İzin tarihi</dt>
            <dd>
              {initial!.consentAt
                ? new Date(initial!.consentAt).toLocaleString("tr-TR")
                : "—"}
            </dd>
          </div>
          {initial!.unsubscribedAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Abonelikten çıkış</dt>
              <dd>{new Date(initial!.unsubscribedAt).toLocaleString("tr-TR")}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Listeler</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {initial!.lists.length
                ? initial!.lists.map((l) => <Badge key={l.id}>{l.name}</Badge>)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Etiketler</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {initial!.tags.length
                ? initial!.tags.map((t) => <Badge key={t.id}>{t.name}</Badge>)
                : "—"}
            </dd>
          </div>
        </dl>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Kaydediliyor…" : editing ? "Kaydet" : "Kişiyi ekle"}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/audience/contacts">Vazgeç</Link>
            </Button>
          </div>
          {editing ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" className="text-danger">
                  Kişiyi sil
                </Button>
              }
              title="Bu kişi silinsin mi?"
              description="Kişi ve tüm liste/etiket bağlantıları kalıcı olarak silinir. Gönderim geçmişi korunur."
              confirmLabel="Kalıcı olarak sil"
              onConfirm={async () => {
                const result = await apiCall(`/api/contacts/${initial!.id}`, "DELETE");
                if (result.ok) router.replace("/audience/contacts");
                else setError(result.message);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
