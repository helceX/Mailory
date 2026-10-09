"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog, Field, Input } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "./labels";

type Item = {
  id: string;
  name: string;
  description?: string | null;
  contactCount: number;
};

/** Lists and tags share one shape: a named group with a member count, link to its contacts, create and delete. */
export function GroupManager({
  kind,
  items,
  canWrite,
}: {
  kind: "list" | "tag";
  items: Item[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const noun = kind === "list" ? "liste" : "etiket";
  const base = kind === "list" ? "/api/lists" : "/api/tags";
  const filterParam = kind === "list" ? "listId" : "tagId";

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    const result = await apiCall(base, "POST", {
      name: String(data.get("name") ?? ""),
      ...(kind === "list"
        ? { description: String(data.get("description") ?? "") }
        : {}),
    });
    setPending(false);
    if (!result.ok) return setError(result.message);
    form.reset();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <form
          onSubmit={create}
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-4"
        >
          <Field
            id={`${kind}-name`}
            label={kind === "list" ? "Yeni liste adı" : "Yeni etiket adı"}
            className="min-w-[200px] flex-1"
          >
            <Input name="name" required maxLength={80} />
          </Field>
          {kind === "list" ? (
            <Field
              id="list-desc"
              label="Açıklama (isteğe bağlı)"
              className="min-w-[200px] flex-1"
            >
              <Input name="description" maxLength={300} />
            </Field>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Ekleniyor…" : `${kind === "list" ? "Liste" : "Etiket"} ekle`}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Henüz {noun} yok.{" "}
          {kind === "list"
            ? "Listeler, kampanyalarınızı gönderebileceğiniz kişi gruplarıdır."
            : "Etiketlerle kişileri serbestçe işaretleyip filtreleyebilirsiniz."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-surface">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{item.name}</div>
                {item.description ? (
                  <div className="text-xs text-muted-foreground">
                    {item.description}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Link
                  href={`/audience/contacts?${filterParam}=${item.id}`}
                  className="text-primary hover:underline tabular-nums"
                >
                  {item.contactCount.toLocaleString("tr-TR")} kişi
                </Link>
                {canWrite ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        Sil
                      </Button>
                    }
                    title={`“${item.name}” silinsin mi?`}
                    description={`${kind === "list" ? "Liste" : "Etiket"} silinir; içindeki kişiler silinmez, yalnızca bu gruptan çıkar.`}
                    confirmLabel="Sil"
                    onConfirm={async () => {
                      const result = await apiCall(`${base}/${item.id}`, "DELETE");
                      if (!result.ok) setError(result.message);
                      router.refresh();
                    }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
