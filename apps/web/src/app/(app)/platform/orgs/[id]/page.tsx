import { notFound } from "next/navigation";
import { z } from "zod";
import { PLAN_KEYS, PLAN_LABELS } from "@mailory/core";
import { Badge } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import {
  BackLink,
  DailyLimit,
  JoinOrg,
  KindControls,
  LimitsEditor,
  PlanPicker,
  SuspendControls,
} from "@/components/platform/admin-forms";
import { getDb } from "@/lib/db";
import { orgDeps } from "@/lib/org/context";
import { requirePlatformAdmin } from "@/lib/platform/page-guard";
import { getOrgFor, listOrgsFor } from "@/lib/platform/service";

export const metadata = { title: "Çalışma alanı" };
export const dynamic = "force-dynamic";

export default async function PlatformOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await getOrgFor(orgDeps(), admin, id);
  if (!r.ok) notFound();
  const all = await listOrgsFor(orgDeps(), admin);
  const partners = all.ok
    ? all.orgs
        .filter((o) => o.type === "partner" && o.id !== id)
        .map((o) => ({ id: o.id, name: o.name }))
    : [];
  void getDb;
  const m = r.metrics;
  const endpoint = `/api/platform/orgs/${id}`;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <BackLink href="/platform">Platform</BackLink>
      <PageHeader
        title={m.name}
        description={`${m.type === "partner" ? "Partner" : "Çalışma alanı"} · ${m.members} üye · ${m.contacts.toLocaleString("tr-TR")} kişi · bu ay ${m.sentThisMonth.toLocaleString("tr-TR")} e-posta`}
        actions={
          m.suspendedAt ? (
            <Badge tone="danger">Askıda</Badge>
          ) : (
            <Badge tone="success">Etkin</Badge>
          )
        }
      />
      <section className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
        <h2 className="text-sm font-semibold">
          Plan · şu an:{" "}
          {PLAN_LABELS[r.entitlements.planKey as keyof typeof PLAN_LABELS] ??
            r.entitlements.planKey}
        </h2>
        <PlanPicker
          endpoint={endpoint}
          plans={[...PLAN_KEYS]}
          current={r.entitlements.planKey}
        />
        <DailyLimit endpoint={endpoint} current={m.dailySendLimit} />
        <KindControls
          endpoint={endpoint}
          type={m.type}
          parentId={m.parentOrganizationId}
          partners={partners}
        />
      </section>
      <JoinOrg endpoint={endpoint} />
      <LimitsEditor endpoint={endpoint} rows={r.entitlements.rows} allowUnlimited />
      <SuspendControls
        endpoint={endpoint}
        suspended={Boolean(m.suspendedAt)}
        reason={m.suspendedReason}
      />
    </div>
  );
}
