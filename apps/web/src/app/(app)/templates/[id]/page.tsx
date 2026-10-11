import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { can, logoSrcFor } from "@mailory/core";
import { TemplateEditor } from "@/components/templates/template-editor";
import { audienceDeps } from "@/lib/audience/deps";
import { getFields } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";
import { templateDeps } from "@/lib/templates/deps";
import { getTemplateFor, loadBrandKit } from "@/lib/templates/service";

export const metadata = { title: "Şablon düzenle" };
export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = (await getOrgContext())!.actor!;
  const deps = templateDeps();
  const [result, brand, fields] = await Promise.all([
    getTemplateFor(deps, actor, id),
    loadBrandKit(deps, actor),
    getFields(audienceDeps(), actor),
  ]);
  if (!result.ok) notFound(); // a foreign tenant's id is indistinguishable from a missing one

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3">
      <Link
        href="/templates"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Şablonlar
      </Link>
      <TemplateEditor
        templateId={id}
        initial={{
          name: result.template.name,
          category: result.template.category,
          version: result.version,
          doc: result.doc,
        }}
        brand={brand}
        logoUrl={logoSrcFor(brand)}
        customKeys={fields.ok ? fields.fields.map((f) => f.key) : []}
        canWrite={can(actor.role, "templates:write") && !result.template.archivedAt}
      />
    </div>
  );
}
