import { flatten, waitMs, type ConditionStep, type Step } from "@mailory/core";
import {
  asOrganizationId,
  claimDueEnrollments,
  contactHasTag,
  contactInList,
  enrollByTrigger,
  findAutomationRecipient,
  getActiveAutomationsByIds,
  getContactForSend,
  getRecipient,
  getStepCampaign,
  isSuppressedNow,
  listActiveAutomations,
  queueAutomationRecipient,
  updateEnrollment,
  type Automation,
  type AutomationEnrollment,
  type Database,
} from "@mailory/db";

export type AutomationDeps = {
  db: Database;
  now?: () => Date;
  scope?: { organizationId?: string };
  log?: (message: string, data?: unknown) => void;
};
const clock = (d: AutomationDeps) => (d.now ?? (() => new Date()))();
const MAX_NODES_PER_RUN = 25;

/** Enrols contacts that triggered each active automation since it went live. */
export async function enrollTriggers(deps: AutomationDeps) {
  const now = clock(deps);
  let enrolled = 0;
  for (const a of await listActiveAutomations(deps.db, 200, deps.scope)) {
    const first = flatten(a.steps as Step[]).first;
    if (!first) continue;
    enrolled += await enrollByTrigger(
      deps.db,
      asOrganizationId(a.organizationId),
      a,
      first,
      now,
    );
  }
  return enrolled;
}

async function evalCondition(
  deps: AutomationDeps,
  e: AutomationEnrollment,
  check: ConditionStep["check"],
): Promise<boolean> {
  const org = asOrganizationId(e.organizationId);
  switch (check.kind) {
    case "has_tag":
      return contactHasTag(deps.db, org, e.contactId, check.tagId);
    case "in_list":
      return contactInList(deps.db, org, e.contactId, check.listId);
    case "opened_previous":
    case "clicked_previous": {
      if (!e.lastRecipientId) return false;
      const r = await getRecipient(deps.db, org, e.lastRecipientId);
      return Boolean(check.kind === "opened_previous" ? r?.openedAt : r?.clickedAt);
    }
  }
}

export type RunResult = "waiting" | "completed" | "exited";

/** Advances one enrolment until it blocks on a wait, finishes, or exits. Each state change is persisted. */
export async function runEnrollment(
  deps: AutomationDeps,
  automation: Automation,
  e: AutomationEnrollment,
): Promise<RunResult> {
  const org = asOrganizationId(e.organizationId);
  const now = clock(deps);
  const exit = async (reason: string): Promise<RunResult> => {
    await updateEnrollment(deps.db, org, e.id, {
      status: "exited",
      exitReason: reason,
      finishedAt: now,
    });
    return "exited";
  };
  const contact = await getContactForSend(deps.db, org, e.contactId);
  if (!contact) return exit("contact_deleted");
  // Unsubscribes, bounces and suppression end the flow at the next step boundary — before any further email.
  if (
    contact.status !== "subscribed" ||
    (await isSuppressedNow(deps.db, org, contact.email))
  )
    return exit("no_longer_subscribed");

  const { nodes } = flatten(automation.steps as Step[]);
  let stepId = e.currentStepId;
  let lastRecipientId = e.lastRecipientId;
  for (let guard = 0; guard < MAX_NODES_PER_RUN; guard++) {
    if (stepId === null) {
      await updateEnrollment(deps.db, org, e.id, {
        status: "completed",
        currentStepId: null,
        finishedAt: now,
        lastRecipientId,
      });
      return "completed";
    }
    const node = nodes.get(stepId);
    if (!node) return exit("step_missing");
    const step = node.step;
    if (step.type === "email") {
      const campaign = await getStepCampaign(deps.db, org, automation.id, step.id);
      if (!campaign) return exit("step_campaign_missing");
      const queued =
        (await queueAutomationRecipient(
          deps.db,
          org,
          campaign.id,
          contact.id,
          contact.email,
          now,
        )) ?? (await findAutomationRecipient(deps.db, org, campaign.id, contact.id)); // replay after a crash
      lastRecipientId = queued ?? lastRecipientId;
      stepId = node.next;
      await updateEnrollment(deps.db, org, e.id, {
        currentStepId: stepId,
        lastRecipientId,
      });
    } else if (step.type === "wait") {
      await updateEnrollment(deps.db, org, e.id, {
        currentStepId: node.next,
        nextRunAt: new Date(now.getTime() + waitMs(step)),
        lastRecipientId,
      });
      return "waiting";
    } else {
      const yes = await evalCondition(deps, { ...e, lastRecipientId }, step.check);
      stepId = (yes ? step.yes : step.no)[0]?.id ?? null;
      await updateEnrollment(deps.db, org, e.id, { currentStepId: stepId });
    }
  }
  return exit("too_many_steps");
}

/** Processes due enrolments (claimed with a lease so concurrent workers never share one). */
export async function processEnrollments(deps: AutomationDeps, limit = 200) {
  const now = clock(deps);
  const claimed = await claimDueEnrollments(deps.db, now, limit, deps.scope);
  const cache = new Map<string, Automation>();
  const summary = { processed: 0, waiting: 0, completed: 0, exited: 0, errors: 0 };
  const all = await getActiveAutomationsByIds(deps.db, [
    ...new Set(claimed.map((e) => e.automationId)),
  ]);
  for (const a of all) cache.set(a.id, a);
  for (const e of claimed) {
    const a = cache.get(e.automationId);
    if (!a) continue; // paused between claim and run: the lease expires and it is retried when active again
    try {
      const r = await runEnrollment(deps, a, e);
      summary.processed++;
      summary[r]++;
    } catch (error) {
      summary.errors++;
      deps.log?.("enrollment failed", { id: e.id, error: String(error) });
    }
  }
  return summary;
}

export async function automationTick(deps: AutomationDeps) {
  const enrolled = await enrollTriggers(deps);
  const run = await processEnrollments(deps);
  return { enrolled, ...run };
}
