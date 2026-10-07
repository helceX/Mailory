import { notFound } from "next/navigation";
import { z } from "zod";
import { PLAN_LABELS } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import {
  BackLink,
  EndSponsorship,
  LimitsEditor,
  PlanPicker,
  SuspendControls,
} from "@/components/platform/admin-forms";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { getChildFor, SPONSORABLE_PLANS } from "@/lib/partner/service";

export const metadata = { title: "Girişimci" };
export const dynamic = "force-dynamic";

export default async function ChildPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = (await getOrgContext())!.actor!;
  const r = await getChildFor(orgDeps(), actor, id);
  if (!r.ok) notFound();
  const c = r.child;
  const endpoint = `/api/partner/children/${id}`;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <BackLink href="/partner">Partner paneli</BackLink>
      <PageHeader
        title={c.name}
        description={`${PLAN_LABELS[r.entitlements.planKey as keyof typeof PLAN_LABELS] ?? r.entitlements.planKey} · ${c.members} üye · ${c.contacts.toLocaleString("tr-TR")} kişi · bu ay ${c.sentThisMonth.toLocaleString("tr-TR")} e-posta`}
      />
      <section className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
        <h2 className="text-sm font-semibold">Sponsorlu plan</h2>
        <PlanPicker
          endpoint={endpoint}
          plans={SPONSORABLE_PLANS}
          current={r.entitlements.planKey}
        />
        <EndSponsorship endpoint={endpoint} />
      </section>
      <LimitsEditor
        endpoint={endpoint}
        rows={r.entitlements.rows}
        allowUnlimited={false}
      />
      <SuspendControls
        endpoint={endpoint}
        suspended={Boolean(c.suspendedAt)}
        reason={c.suspendedReason}
      />
      <p className="text-xs text-muted-foreground">
        Bu çalışma alanının kişileri, kampanyaları ve raporları gizlidir; yalnızca
        sahibine aittir.
      </p>
    </div>
  );
}
