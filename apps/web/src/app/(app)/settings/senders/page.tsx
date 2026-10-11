import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { SendersManager } from "@/components/senders/senders-manager";
import { getOrgContext } from "@/lib/org/context";
import { senderDeps } from "@/lib/senders/deps";
import { listIdentities } from "@/lib/senders/service";

export const metadata = { title: "Göndericiler" };
export const dynamic = "force-dynamic";

export default async function SendersPage() {
  const actor = (await getOrgContext())!.actor!;
  const result = await listIdentities(senderDeps(), actor);
  return (
    <>
      <PageHeader
        title="Göndericiler"
        description="Kampanyalarınızın “Kimden” bilgisi. Gerçek gönderim için adresin alan adı doğrulanmış olmalıdır."
      />
      <SendersManager
        canManage={can(actor.role, "sender:manage")}
        identities={result.ok ? result.identities : []}
      />
    </>
  );
}
