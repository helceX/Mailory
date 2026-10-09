"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail } from "lucide-react";
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

type Identity = {
  id: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  isDefault: boolean;
  usable: boolean;
  domain: { id: string; domain: string; status: string } | null;
};

export function SendersManager({
  identities,
  canManage,
}: {
  identities: Identity[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>, id: string | null) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    const body = {
      fromName: String(data.get("fromName") ?? ""),
      fromEmail: String(data.get("fromEmail") ?? ""),
      replyTo: String(data.get("replyTo") ?? ""),
    };
    const result = id
      ? await apiCall(`/api/sender-identities/${id}`, "PATCH", body)
      : await apiCall("/api/sender-identities", "POST", body);
    setPending(false);
    if (!result.ok) return setError(result.message);
    if (!id) form.reset();
    setEditing(null);
    router.refresh();
  }

  const fields = (i?: Identity) => (
    <>
      <Field
        id={`fn-${i?.id ?? "new"}`}
        label="Gönderici adı"
        hint="Alıcıların gelen kutusunda göreceği ad."
        className="min-w-[180px] flex-1"
      >
        <Input
          name="fromName"
          required
          maxLength={80}
          defaultValue={i?.fromName}
          placeholder="Acme Haber"
        />
      </Field>
      <Field
        id={`fe-${i?.id ?? "new"}`}
        label="Gönderici e-posta"
        hint="Kendi alan adınızdan bir adres."
        className="min-w-[220px] flex-1"
      >
        <Input
          name="fromEmail"
          type="email"
          required
          defaultValue={i?.fromEmail}
          placeholder="haber@sirketiniz.com"
        />
      </Field>
      <Field
        id={`rt-${i?.id ?? "new"}`}
        label="Yanıt adresi (isteğe bağlı)"
        hint="Yanıtların gideceği adres."
        className="min-w-[200px] flex-1"
      >
        <Input
          name="replyTo"
          type="email"
          defaultValue={i?.replyTo ?? ""}
          placeholder="destek@sirketiniz.com"
        />
      </Field>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <form
          onSubmit={(e) => submit(e, null)}
          className="flex flex-wrap items-start gap-3 rounded-lg border bg-surface p-4"
        >
          {fields()}
          <Button type="submit" disabled={pending} className="mt-6">
            {pending ? "Ekleniyor…" : "Gönderici ekle"}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
      {identities.length === 0 ? (
        <EmptyState
          icon={<Mail className="size-6" aria-hidden="true" />}
          title="Henüz gönderici adresiniz yok."
          description="Kampanyalarınızın kimin adına gideceğini belirleyen bir gönderici ekleyin. Alan adınızı doğrulamadan önce de ekleyebilirsiniz."
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-surface">
          {identities.map((i) => (
            <li key={i.id} className="flex flex-col gap-3 px-4 py-3">
              {editing === i.id ? (
                <form
                  onSubmit={(e) => submit(e, i.id)}
                  className="flex flex-wrap items-start gap-3"
                >
                  {fields(i)}
                  <div className="mt-6 flex gap-2">
                    <Button type="submit" disabled={pending}>
                      Kaydet
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditing(null)}
                    >
                      Vazgeç
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.fromName}</span>
                      <span className="text-sm text-muted-foreground">
                        &lt;{i.fromEmail}&gt;
                      </span>
                      {i.isDefault ? <Badge tone="info">Varsayılan</Badge> : null}
                      <Badge tone={i.usable ? "success" : "warning"}>
                        {i.usable ? "Gönderime hazır" : "Yalnızca test"}
                      </Badge>
                    </div>
                    {i.replyTo ? (
                      <div className="text-xs text-muted-foreground">
                        Yanıt: {i.replyTo}
                      </div>
                    ) : null}
                    {!i.usable ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {i.domain ? (
                          <>“{i.domain.domain}” alan adı henüz doğrulanmadı. </>
                        ) : (
                          <>Bu adresin alan adı henüz eklenmedi. </>
                        )}
                        {canManage ? (
                          <Link
                            href={
                              i.domain
                                ? `/settings/domains/${i.domain.id}`
                                : "/settings/domains"
                            }
                            className="text-primary hover:underline"
                          >
                            {i.domain ? "Doğrulamayı tamamlayın" : "Alan adını ekleyin"}
                          </Link>
                        ) : (
                          "Bir yöneticinin alan adını doğrulaması gerekir."
                        )}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      {!i.isDefault ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const r = await apiCall(
                              `/api/sender-identities/${i.id}/default`,
                              "POST",
                            );
                            if (!r.ok) setError(r.message);
                            router.refresh();
                          }}
                        >
                          Varsayılan yap
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setEditing(i.id);
                        }}
                      >
                        Düzenle
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Sil
                          </Button>
                        }
                        title={`${i.fromEmail} silinsin mi?`}
                        description="Bu gönderici kaldırılır. Bu göndericiyi kullanan taslak kampanyalar için başka bir gönderici seçmeniz gerekir."
                        confirmLabel="Sil"
                        onConfirm={async () => {
                          const r = await apiCall(
                            `/api/sender-identities/${i.id}`,
                            "DELETE",
                          );
                          if (!r.ok) setError(r.message);
                          router.refresh();
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
