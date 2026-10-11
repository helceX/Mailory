import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { DomainsManager } from "@/components/senders/domains-manager";
import { getOrgContext } from "@/lib/org/context";
import { senderDeps } from "@/lib/senders/deps";
import { listDomains } from "@/lib/senders/service";

export const metadata = { title: "Alan adları" };
export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const actor = (await getOrgContext())!.actor!;
  const result = await listDomains(senderDeps(), actor);
  return (
    <>
      <PageHeader
        title="Alan adları"
        description="E-postaları kendi alan adınızdan gönderin. Doğrulanmış alan adı, e-postalarınızın spam'e düşme riskini ciddi biçimde azaltır."
      />
      <DomainsManager
        canManage={can(actor.role, "sender:manage")}
        domains={
          result.ok
            ? result.domains.map((d) => ({
                id: d.id,
                domain: d.domain,
                status: d.status,
                lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
              }))
            : []
        }
      />
    </>
  );
}
