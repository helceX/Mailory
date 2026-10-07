"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, ConfirmDialog } from "@mailory/ui";
import { CATEGORY_LABELS } from "@mailory/validation/labels";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";
import { NameDialog } from "./name-dialog";

type Row = {
  id: string;
  name: string;
  category: string;
  version: number | null;
  updatedAt: string;
  sourceLibraryKey: string | null;
};
type LibraryItem = { key: string; name: string; category: string; description: string };

const label = (c: string) => CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c;

export function NewBlankButton({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  if (!canWrite) return null;
  return (
    <NameDialog
      trigger={
        <Button>
          <Plus aria-hidden="true" /> Boş şablon
        </Button>
      }
      title="Yeni şablon"
      description="Marka kitinizle (logo, renkler, alt bilgi) hazır bir başlangıç şablonu oluşturulur."
      submitLabel="Oluştur"
      withCategory
      onSubmit={async ({ name, category }) => {
        const result = await apiCall("/api/templates", "POST", { name, category });
        if (!result.ok) return result.message;
        router.push(`/templates/${(result.data as { id: string }).id}`);
        return null;
      }}
    />
  );
}

export function TemplatesList({
  rows,
  archived,
  canWrite,
}: {
  rows: Row[];
  archived: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <ul className="divide-y rounded-lg border bg-surface">
        {rows.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <Link
                href={`/templates/${t.id}`}
                className="font-medium hover:text-primary hover:underline"
              >
                {t.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>{label(t.category)}</Badge>
                <span>Sürüm {t.version ?? 1}</span>
                <span>
                  Güncellendi {new Date(t.updatedAt).toLocaleDateString("tr-TR")}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button asChild variant="secondary" size="sm">
                <Link href={`/templates/${t.id}`}>
                  {canWrite && !archived ? "Düzenle" : "Görüntüle"}
                </Link>
              </Button>
              {canWrite && !archived ? (
                <NameDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      Kopyala
                    </Button>
                  }
                  title="Şablonu kopyala"
                  description="Güncel içerik yeni bir şablon olarak kopyalanır."
                  defaultName={`${t.name} (kopya)`}
                  submitLabel="Kopyala"
                  onSubmit={async ({ name }) => {
                    const result = await apiCall(
                      `/api/templates/${t.id}/duplicate`,
                      "POST",
                      { name },
                    );
                    if (!result.ok) return result.message;
                    router.push(`/templates/${(result.data as { id: string }).id}`);
                    return null;
                  }}
                />
              ) : null}
              {canWrite ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      {archived ? "Geri yükle" : "Arşivle"}
                    </Button>
                  }
                  title={
                    archived
                      ? `“${t.name}” geri yüklensin mi?`
                      : `“${t.name}” arşivlensin mi?`
                  }
                  description={
                    archived
                      ? "Şablon yeniden etkin şablonlar arasında görünür."
                      : "Şablon listeden kalkar; sürümleri ve bu şablonu kullanan kampanyalar korunur. İstediğiniz zaman geri yükleyebilirsiniz."
                  }
                  confirmLabel={archived ? "Geri yükle" : "Arşivle"}
                  onConfirm={async () => {
                    const result = await apiCall(
                      `/api/templates/${t.id}/archive`,
                      "POST",
                      { archived: !archived },
                    );
                    if (!result.ok) setError(result.message);
                    router.refresh();
                  }}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LibraryGallery({
  items,
  canWrite,
}: {
  items: LibraryItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t) => (
        <li
          key={t.key}
          className="flex flex-col overflow-hidden rounded-lg border bg-surface"
        >
          <div
            className="relative h-56 overflow-hidden border-b bg-surface-muted"
            aria-hidden="true"
          >
            {/* Sandboxed: the preview HTML cannot run script even if it ever contained some. */}
            <iframe
              title={`${t.name} önizlemesi`}
              src={`/api/templates/library/${t.key}/preview`}
              sandbox=""
              loading="lazy"
              tabIndex={-1}
              className="pointer-events-none absolute left-0 top-0 border-0"
              style={{
                width: 640,
                height: 900,
                transform: "scale(0.42)",
                transformOrigin: "top left",
              }}
            />
          </div>
          <div className="flex flex-1 flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{t.name}</h3>
              <Badge>{label(t.category)}</Badge>
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{t.description}</p>
            {canWrite ? (
              <NameDialog
                trigger={
                  <Button variant="secondary" className="w-full">
                    Bu şablonla başla
                  </Button>
                }
                title={`“${t.name}” ile başla`}
                description="Şablon markanızla uyarlanıp düzenlenebilir bir kopya olarak eklenir."
                defaultName={t.name}
                submitLabel="Oluştur"
                onSubmit={async ({ name }) => {
                  const result = await apiCall("/api/templates", "POST", {
                    name,
                    category: "other",
                    libraryKey: t.key,
                  });
                  if (!result.ok) return result.message;
                  router.push(`/templates/${(result.data as { id: string }).id}`);
                  return null;
                }}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
