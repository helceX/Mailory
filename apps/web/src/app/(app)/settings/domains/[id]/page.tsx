import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { DomainDetail } from "@/components/senders/domain-detail";
import type { RecordResultView } from "@/components/senders/labels";
import { getOrgContext } from "@/lib/org/context";
import { senderDeps } from "@/lib/senders/deps";
import { getDomainDetail } from "@/lib/senders/service";

export const metadata = { title: "Alan adı doğrulama" };
export const dynamic = "force-dynamic";

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = (await getOrgContext())!.actor!;
  if (!can(actor.role, "sender:manage")) redirect("/settings/domains");
  const result = await getDomainDetail(senderDeps(), actor, id);
  if (!result.ok) notFound(); // another workspace's id is indistinguishable from a missing one
  const { domain, records } = result;
  return (
    <>
      <Link
        href="/settings/domains"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Alan adları
      </Link>
      <PageHeader
        title={domain.domain}
        description="Aşağıdaki DNS kayıtlarını alan adınızın DNS ayarlarına ekleyin."
      />
      <DomainDetail
        domain={{
          id: domain.id,
          domain: domain.domain,
          status: domain.status,
          lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
          verifiedAt: domain.verifiedAt?.toISOString() ?? null,
          lastError: domain.lastError,
          failingSince: domain.failingSince?.toISOString() ?? null,
        }}
        records={records}
        results={
          (Array.isArray(domain.lastCheck)
            ? domain.lastCheck
            : []) as RecordResultView[]
        }
      />
    </>
  );
}
