import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { can } from "@mailory/core";
import { LIBRARY_TEMPLATES } from "@mailory/email";
import { Button, EmptyState } from "@mailory/ui";
import { AiDraftButton } from "@/components/ai/ai-panels";
import { aiDeps } from "@/lib/ai/deps";
import { getAiStatus } from "@/lib/ai/service";
import { PageHeader } from "@/components/page-header";
import {
  LibraryGallery,
  ImportTemplateButton,
  NewBlankButton,
  TemplatesList,
} from "@/components/templates/templates-view";
import { getOrgContext } from "@/lib/org/context";
import { templateDeps } from "@/lib/templates/deps";
import { listTemplatesFor } from "@/lib/templates/service";

export const metadata = { title: "Şablonlar" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "mine", label: "Şablonlarım" },
  { key: "library", label: "Kütüphane" },
  { key: "archive", label: "Arşiv" },
] as const;

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tabs: { key: string; label: string }[] = [...TABS];
  const tab = tabs.find((t) => t.key === tabParam)?.key ?? "mine";
  const actor = (await getOrgContext())!.actor!;
  const canWrite = can(actor.role, "templates:write");
  const aiStatus = await getAiStatus(aiDeps(), actor);
  const ai = aiStatus.ok
    ? { available: aiStatus.available, enabled: aiStatus.enabled }
    : { available: false, enabled: false };
  const result =
    tab === "library"
      ? null
      : await listTemplatesFor(templateDeps(), actor, { archived: tab === "archive" });
  const rows = result?.ok
    ? result.templates.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        version: t.version,
        updatedAt: t.updatedAt.toISOString(),
        sourceLibraryKey: t.sourceLibraryKey,
      }))
    : [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Şablonlar"
        description="E-postalarınızı hızla hazırlayın; her şablon markanızla uyumlu başlar."
        actions={
          <div className="flex flex-wrap gap-2">
            <AiDraftButton ai={ai} canWrite={canWrite} />
            <ImportTemplateButton canWrite={canWrite} />
            <NewBlankButton canWrite={canWrite} />
          </div>
        }
      />
      <nav aria-label="Şablon görünümleri" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/templates?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "library" ? (
        <LibraryGallery
          items={LIBRARY_TEMPLATES.map((t) => ({
            key: t.key,
            name: t.name,
            category: t.category,
            description: t.description,
          }))}
          canWrite={canWrite}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate className="size-6" aria-hidden="true" />}
          title={
            tab === "archive" ? "Arşivde şablon yok." : "Henüz şablonunuz bulunmuyor."
          }
          description={
            tab === "archive"
              ? "Arşivlediğiniz şablonlar burada görünür."
              : "Kütüphaneden hazır bir şablonla başlayın veya boş bir şablon oluşturun."
          }
          action={
            tab === "mine" ? (
              <Button asChild>
                <Link href="/templates?tab=library">Kütüphaneye göz at</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TemplatesList rows={rows} archived={tab === "archive"} canWrite={canWrite} />
      )}
    </div>
  );
}
