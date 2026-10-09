import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { GroupManager } from "@/components/audience/lists-manager";
import { audienceDeps } from "@/lib/audience/deps";
import { getTags } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Etiketler" };
export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const actor = (await getOrgContext())!.actor!;
  const tags = await getTags(audienceDeps(), actor);
  return (
    <>
      <PageHeader
        title="Etiketler"
        description="Kişileri serbestçe işaretleyin ve etikete göre filtreleyin."
      />
      <GroupManager
        kind="tag"
        items={tags.ok ? tags.tags : []}
        canWrite={can(actor.role, "contacts:write")}
      />
    </>
  );
}
