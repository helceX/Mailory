import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  can,
  type AutomationStatus,
  type AutomationTrigger,
  type Step,
} from "@mailory/core";
import { AutomationBuilder } from "@/components/automations/builder";
import { PageHeader } from "@/components/page-header";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists, getTags } from "@/lib/audience/service";
import { automationDeps } from "@/lib/automations/deps";
import { getAutomationFor } from "@/lib/automations/service";
import { getOrgContext } from "@/lib/org/context";
import { senderDeps } from "@/lib/senders/deps";
import { listIdentities } from "@/lib/senders/service";
import { templateDeps } from "@/lib/templates/deps";
import { listTemplatesFor } from "@/lib/templates/service";

export const metadata = { title: "Otomasyon" };
export const dynamic = "force-dynamic";

export default async function AutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = (await getOrgContext())!.actor!;
  const r = await getAutomationFor(automationDeps(), actor, id);
  if (!r.ok) notFound();
  const [templates, identities, lists, tags] = await Promise.all([
    listTemplatesFor(templateDeps(), actor),
    listIdentities(senderDeps(), actor),
    getLists(audienceDeps(), actor),
    getTags(audienceDeps(), actor),
  ]);
  const a = r.automation;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Link
        href="/automations"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Otomasyon
      </Link>
      <PageHeader title={a.name} />
      <AutomationBuilder
        automation={{
          id: a.id,
          name: a.name,
          status: a.status as AutomationStatus,
          trigger: a.trigger as AutomationTrigger,
          steps: a.steps as Step[],
        }}
        templates={
          templates.ok
            ? templates.templates.map((t) => ({ id: t.id, name: t.name }))
            : []
        }
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
        lists={lists.ok ? lists.lists.map((l) => ({ id: l.id, name: l.name })) : []}
        tags={tags.ok ? tags.tags.map((t) => ({ id: t.id, name: t.name })) : []}
        issues={r.readiness?.issues ?? []}
        warnings={r.readiness?.warnings ?? []}
        counts={r.counts}
        exitReasons={r.exitReasons}
        stepStats={Object.fromEntries(r.stepStats.map((s) => [s.stepId, s.stats]))}
        canWrite={can(actor.role, "campaigns:write")}
        canSend={can(actor.role, "campaigns:send")}
        requireApproval={r.requireApproval}
        canApprove={can(actor.role, "campaigns:approve")}
      />
    </div>
  );
}
