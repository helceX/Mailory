import { can } from "@mailory/core";
import {
  AutomationsTable,
  NewAutomationButton,
  type AutomationRow,
} from "@/components/automations/automations-list";
import { PageHeader } from "@/components/page-header";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists, getTags } from "@/lib/audience/service";
import { automationDeps } from "@/lib/automations/deps";
import { listAutomationsFor } from "@/lib/automations/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Otomasyon" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const actor = (await getOrgContext())!.actor!;
  const [r, lists, tags] = await Promise.all([
    listAutomationsFor(automationDeps(), actor),
    getLists(audienceDeps(), actor),
    getTags(audienceDeps(), actor),
  ]);
  const rows: AutomationRow[] = r.ok
    ? r.automations.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status as AutomationRow["status"],
        trigger: a.trigger,
        active: a.active,
        completed: a.completed,
        exited: a.exited,
      }))
    : [];
  const canWrite = can(actor.role, "campaigns:write");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Otomasyon"
        description="Bir olay gerçekleştiğinde kendiliğinden çalışan e-posta akışları."
        actions={
          <NewAutomationButton
            canWrite={canWrite}
            lists={lists.ok ? lists.lists.map((l) => ({ id: l.id, name: l.name })) : []}
            tags={tags.ok ? tags.tags.map((t) => ({ id: t.id, name: t.name })) : []}
          />
        }
      />
      <AutomationsTable rows={rows} canWrite={canWrite} />
    </div>
  );
}
