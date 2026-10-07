"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, NativeSelect } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

export function PublishForm({
  templates,
}: {
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-4">
      <Field
        id="pub"
        label="Yayınlanacak şablon"
        hint="Şablonun o anki hâlinin kopyası paylaşılır; sonraki düzenlemeler otomatik yansımaz."
        className="min-w-[260px] flex-1"
      >
        <NativeSelect value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Seçin…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button
        disabled={!id || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await apiCall("/api/partner/hub", "POST", { templateId: id });
          setBusy(false);
          if (!r.ok) return setError(r.message);
          setId("");
          router.refresh();
        }}
      >
        Şablon Merkezi'ne yayınla
      </Button>
      <div className="w-full">
        <FormError message={error} />
      </div>
    </div>
  );
}

export function UnpublishButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-danger"
      onClick={async () => {
        await apiCall(`/api/partner/hub/${id}`, "DELETE");
        router.refresh();
      }}
    >
      Yayından kaldır
    </Button>
  );
}

export function UseHubButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await apiCall(`/api/hub/${id}/use`, "POST");
          setBusy(false);
          if (!r.ok) return setError(r.message);
          router.push(`/templates/${(r.data as { id: string }).id}`);
        }}
      >
        {busy ? "Kopyalanıyor…" : "Kendi şablonlarıma ekle"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
