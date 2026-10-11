import { redirect } from "next/navigation";
import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { SegmentBuilder } from "@/components/audience/segment-builder";
import { audienceDeps } from "@/lib/audience/deps";
import { getFields, getLists, getTags } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Yeni segment" };
export const dynamic = "force-dynamic";

export default async function NewSegmentPage() {
  const actor = (await getOrgContext())!.actor!;
  if (!can(actor.role, "contacts:write")) redirect("/audience/segments");
  const deps = audienceDeps();
  const [fields, lists, tags] = await Promise.all([
    getFields(deps, actor),
    getLists(deps, actor),
    getTags(deps, actor),
  ]);
  return (
    <>
      <PageHeader title="Yeni segment" />
      <SegmentBuilder
        canWrite
        customFields={
          fields.ok ? fields.fields.map((f) => ({ key: f.key, label: f.label })) : []
        }
        lists={lists.ok ? lists.lists.map((l) => ({ id: l.id, name: l.name })) : []}
        tags={tags.ok ? tags.tags : []}
      />
    </>
  );
}
