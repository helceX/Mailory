import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { can, CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "@mailory/core";
import { CampaignEditor } from "@/components/campaigns/campaign-editor";
import { CampaignStatusPanel } from "@/components/campaigns/campaign-status-panel";
import { PageHeader } from "@/components/page-header";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists, getSegments, getTags } from "@/lib/audience/service";
import { campaignDeps } from "@/lib/campaigns/deps";
import { getCampaignFor, listTestRecipientsFor } from "@/lib/campaigns/service";
import { getOrgContext } from "@/lib/org/context";
import { senderDeps } from "@/lib/senders/deps";
import { listIdentities } from "@/lib/senders/service";
import { templateDeps } from "@/lib/templates/deps";
import { listTemplatesFor } from "@/lib/templates/service";

export const metadata = { title: "Kampanya" };
export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = (await getOrgContext())!;
  const actor = ctx.actor!;
  const result = await getCampaignFor(campaignDeps(), actor, id);
  if (!result.ok) notFound();
  const c = result.campaign;
  const status = c.status as CampaignStatus;
  const canSend = can(actor.role, "campaigns:send");

  const header = (
    <>
      <Link
        href="/campaigns"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Kampanyalar
      </Link>
      <PageHeader title={c.name} description={CAMPAIGN_STATUS_LABELS[status]} />
    </>
  );

  if (status !== "draft" || !can(actor.role, "campaigns:write")) {
    const snap = c.snapshot;
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {header}
        <CampaignStatusPanel
          userId={actor.userId}
          canWrite={can(actor.role, "campaigns:write")}
          canSend={canSend}
          canApprove={can(actor.role, "campaigns:approve")}
          campaign={{
            id: c.id,
            name: c.name,
            subject: c.subject,
            status,
            scheduledAt: c.scheduledAt?.toISOString() ?? null,
            submittedAt: c.submittedAt?.toISOString() ?? null,
            approvedAt: c.approvedAt?.toISOString() ?? null,
            submittedByUserId: c.submittedByUserId,
          }}
          snapshot={
            snap
              ? {
                  audienceCount: snap.audienceCount,
                  version: snap.version,
                  sender: snap.sender,
                }
              : null
          }
        />
      </div>
    );
  }

  const [identities, templates, lists, segments, tags, recipients] = await Promise.all([
    listIdentities(senderDeps(), actor),
    listTemplatesFor(templateDeps(), actor),
    getLists(audienceDeps(), actor),
    getSegments(audienceDeps(), actor),
    getTags(audienceDeps(), actor),
    listTestRecipientsFor(campaignDeps(), actor),
  ]);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {header}
      <CampaignEditor
        campaign={{
          id: c.id,
          name: c.name,
          subject: c.subject,
          preheader: c.preheader,
          senderIdentityId: c.senderIdentityId,
          replyTo: c.replyTo,
          templateId: c.templateId,
          audience: c.audience,
          utm: c.utm,
          trackOpens: c.trackOpens,
          trackClicks: c.trackClicks,
          rejectionReason: c.rejectionReason,
        }}
        issues={result.issues}
        audienceCount={result.audienceCount}
        requireApproval={result.requireApproval}
        canSend={canSend}
        identities={
          identities.ok
            ? identities.identities.map((i) => ({
                id: i.id,
                name: i.fromName,
                fromEmail: i.fromEmail,
                usable: i.usable,
              }))
            : []
        }
        templates={
          templates.ok
            ? templates.templates.map((t) => ({ id: t.id, name: t.name }))
            : []
        }
        lists={lists.ok ? lists.lists.map((l) => ({ id: l.id, name: l.name })) : []}
        segments={
          segments.ok ? segments.segments.map((s) => ({ id: s.id, name: s.name })) : []
        }
        tags={tags.ok ? tags.tags.map((t) => ({ id: t.id, name: t.name })) : []}
        testRecipients={recipients.ok ? recipients.recipients : []}
      />
    </div>
  );
}
