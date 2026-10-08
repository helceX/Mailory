import Link from "next/link";
import {
  can,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  isCampaignStatus,
} from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import {
  ApprovalPolicy,
  FrequencyCapPolicy,
  CampaignsTable,
  NewCampaignButton,
} from "@/components/campaigns/campaigns-list";
import { AiToggle } from "@/components/ai/ai-panels";
import { aiDeps } from "@/lib/ai/deps";
import { getAiStatus } from "@/lib/ai/service";
import { campaignDeps } from "@/lib/campaigns/deps";
import { getPolicyFor, listCampaignsFor } from "@/lib/campaigns/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Kampanyalar" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "Tümü" },
  ...CAMPAIGN_STATUSES.map((s) => ({ key: s, label: CAMPAIGN_STATUS_LABELS[s] })),
];

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: param } = await searchParams;
  const status = param && isCampaignStatus(param) ? param : undefined;
  const actor = (await getOrgContext())!.actor!;
  const deps = campaignDeps();
  const ai = await getAiStatus(aiDeps(), actor);
  const [result, policy] = await Promise.all([
    listCampaignsFor(deps, actor, { status }),
    getPolicyFor(deps, actor),
  ]);
  const rows = result.ok
    ? result.campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status as (typeof CAMPAIGN_STATUSES)[number],
        scheduledAt: c.scheduledAt?.toISOString() ?? null,
        updatedAt: c.updatedAt.toISOString(),
      }))
    : [];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Kampanyalar"
        description="E-posta kampanyalarınızı hazırlayın, test edin, zamanlayın."
        actions={<NewCampaignButton canWrite={can(actor.role, "campaigns:write")} />}
      />
      {can(actor.role, "org:manage_settings") && policy.ok ? (
        <>
          <ApprovalPolicy initial={policy.requireApproval} />
          <FrequencyCapPolicy initial={policy.weeklyCap} />
        </>
      ) : null}
      {can(actor.role, "org:manage_settings") && ai.ok ? (
        <AiToggle initial={ai.enabled} available={ai.available} />
      ) : null}
      <nav aria-label="Kampanya durumları" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const active = (status ?? "all") === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/campaigns" : `/campaigns?status=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <CampaignsTable rows={rows} canWrite={can(actor.role, "campaigns:write")} />
    </div>
  );
}
