import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { GroupManager } from "@/components/audience/lists-manager";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Listeler" };
export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const actor = (await getOrgContext())!.actor!;
  const lists = await getLists(audienceDeps(), actor);
  return (
    <>
      <PageHeader
        title="Listeler"
        description="Kampanyalarınızı gönderebileceğiniz kişi grupları."
      />
      <GroupManager
        kind="list"
        items={lists.ok ? lists.lists : []}
        canWrite={can(actor.role, "contacts:write")}
      />
    </>
  );
}
