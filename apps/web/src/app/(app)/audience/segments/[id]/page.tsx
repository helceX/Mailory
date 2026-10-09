import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { SegmentBuilder } from "@/components/audience/segment-builder";
import { audienceDeps } from "@/lib/audience/deps";
import { getFields, getLists, getSegments, getTags } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Segmenti düzenle" };
export const dynamic = "force-dynamic";

export default async function EditSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = (await getOrgContext())!.actor!;
  const deps = audienceDeps();
  const [segments, fields, lists, tags] = await Promise.all([
    getSegments(deps, actor),
    getFields(deps, actor),
    getLists(deps, actor),
    getTags(deps, actor),
  ]);
  const segment = segments.ok ? segments.segments.find((s) => s.id === id) : undefined;
  if (!segment) notFound();
  return (
    <>
      <PageHeader title={segment.name} />
      <SegmentBuilder
        canWrite={can(actor.role, "contacts:write")}
        initial={{
          id: segment.id,
          name: segment.name,
          definition: segment.definition as never,
        }}
        customFields={
          fields.ok ? fields.fields.map((f) => ({ key: f.key, label: f.label })) : []
        }
        lists={lists.ok ? lists.lists.map((l) => ({ id: l.id, name: l.name })) : []}
        tags={tags.ok ? tags.tags : []}
      />
    </>
  );
}
