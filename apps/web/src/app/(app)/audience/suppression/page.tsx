import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { SuppressionManager } from "@/components/audience/suppression-manager";
import { audienceDeps } from "@/lib/audience/deps";
import { getSuppressions } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Bastırma listesi" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function SuppressionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Math.min(Number(pageParam) || 1, 10_000));
  const actor = (await getOrgContext())!.actor!;
  const result = await getSuppressions(audienceDeps(), actor, {
    q: q.slice(0, 100) || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  return (
    <>
      <PageHeader
        title="Bastırma listesi"
        description="E-posta gönderilmeyecek adresler."
      />
      <SuppressionManager
        rows={
          result.ok
            ? result.rows.map((r) => ({
                id: r.id,
                email: r.email,
                reason: r.reason,
                createdAt: r.createdAt.toISOString(),
              }))
            : []
        }
        total={result.ok ? result.total : 0}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        canWrite={can(actor.role, "contacts:write")}
        canLift={can(actor.role, "org:manage_settings")}
        canExport={can(actor.role, "contacts:export")}
      />
    </>
  );
}
