import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { AutomationTrigger, Step } from "@mailory/core/shared";
import type { Database, OrganizationId } from "../index";
import {
  automationEnrollments,
  automations,
  campaigns,
  campaignRecipients,
  type Automation,
  type AutomationEnrollment,
  type CampaignSnapshot,
} from "../schema/index";
import { contactWhere, type ContactFilter } from "./contacts";

export async function createAutomation(
  db: Database,
  organizationId: OrganizationId,
  input: { name: string; trigger: AutomationTrigger; userId: string | null },
) {
  const [row] = await db
    .insert(automations)
    .values({
      organizationId,
      name: input.name,
      trigger: input.trigger,
      createdByUserId: input.userId,
    })
    .returning();
  return row!;
}

export async function getAutomation(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.organizationId, organizationId), eq(automations.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listAutomations(db: Database, organizationId: OrganizationId) {
  const r = await db.execute<{
    id: string;
    name: string;
    status: string;
    trigger: AutomationTrigger;
    created_at: Date;
    activated_at: Date | null;
    active: number;
    completed: number;
    exited: number;
  }>(sql`
    select a.id, a.name, a.status, a.trigger, a.created_at, a.activated_at,
           count(e.id) filter (where e.status = 'active')::int as active,
           count(e.id) filter (where e.status = 'completed')::int as completed,
           count(e.id) filter (where e.status = 'exited')::int as exited
      from automations a left join automation_enrollments e on e.automation_id = a.id
     where a.organization_id = ${organizationId}::uuid
     group by a.id order by a.created_at desc limit 200`);
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    status: x.status,
    trigger: x.trigger,
    createdAt: new Date(x.created_at),
    activatedAt: x.activated_at ? new Date(x.activated_at) : null,
    active: x.active,
    completed: x.completed,
    exited: x.exited,
  }));
}

/** Drafts only: once an automation has run, its structure is frozen (duplicate it to change it). */
export async function updateAutomationDraft(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  patch: { name?: string; trigger?: AutomationTrigger; steps?: Step[] },
) {
  const [row] = await db
    .update(automations)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(automations.organizationId, organizationId),
        eq(automations.id, id),
        eq(automations.status, "draft"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteAutomationDraft(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(automations)
    .where(
      and(
        eq(automations.organizationId, organizationId),
        eq(automations.id, id),
        eq(automations.status, "draft"),
      ),
    )
    .returning({ id: automations.id });
  return rows.length > 0;
}

export type StepCampaignInput = {
  stepId: string;
  name: string;
  subject: string;
  preheader: string;
  senderIdentityId: string | null;
  templateId: string | null;
  templateVersionId: string | null;
  snapshot: CampaignSnapshot;
};

/**
 * Activates in ONE transaction: creates a hidden, permanently-"sending" campaign per email step (so recipients,
 * sending, tracking, unsubscribe and analytics all work unchanged) and flips the automation to active. CAS on status
 * so a double click cannot create two sets.
 */
export async function activateAutomation(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  stepCampaigns: StepCampaignInput[],
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(automations)
      .set({ status: "active", activatedAt: now, updatedAt: now })
      .where(
        and(
          eq(automations.organizationId, organizationId),
          eq(automations.id, id),
          eq(automations.status, "draft"),
        ),
      )
      .returning();
    if (!row) return null;
    for (const c of stepCampaigns)
      await tx.insert(campaigns).values({
        organizationId,
        name: c.name,
        status: "sending",
        kind: "automation_step",
        automationId: id,
        automationStepId: c.stepId,
        subject: c.subject,
        preheader: c.preheader,
        senderIdentityId: c.senderIdentityId,
        templateId: c.templateId,
        templateVersionId: c.templateVersionId,
        audience: { kind: "all" },
        utm: {
          enabled: true,
          source: "mailory",
          medium: "email",
          campaign: `automation-${id.slice(0, 8)}`,
        },
        snapshot: c.snapshot,
        startedAt: now,
      });
    return row;
  });
}

export async function setAutomationStatus(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  from: string[],
  to: "active" | "paused" | "archived",
) {
  const [row] = await db
    .update(automations)
    .set({ status: to, updatedAt: new Date() })
    .where(
      and(
        eq(automations.organizationId, organizationId),
        eq(automations.id, id),
        inArray(automations.status, from),
      ),
    )
    .returning();
  return row ?? null;
}

/** Ends every still-running enrollment (archiving an automation). */
export async function exitAllEnrollments(
  db: Database,
  organizationId: OrganizationId,
  automationId: string,
  reason: string,
  now: Date,
) {
  await db
    .update(automationEnrollments)
    .set({ status: "exited", exitReason: reason, finishedAt: now })
    .where(
      and(
        eq(automationEnrollments.organizationId, organizationId),
        eq(automationEnrollments.automationId, automationId),
        eq(automationEnrollments.status, "active"),
      ),
    );
}

export async function listStepCampaigns(
  db: Database,
  organizationId: OrganizationId,
  automationId: string,
) {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.automationId, automationId),
        eq(campaigns.kind, "automation_step"),
      ),
    );
}

export async function getStepCampaign(
  db: Database,
  organizationId: OrganizationId,
  automationId: string,
  stepId: string,
) {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.automationId, automationId),
        eq(campaigns.automationStepId, stepId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---- enrolment -------------------------------------------------------------------------------------------------

const ELIGIBLE = (organizationId: OrganizationId) => sql`
  c.organization_id = ${organizationId}::uuid and c.status = 'subscribed'
  and not exists (select 1 from suppressions s where s.organization_id = c.organization_id and s.email = c.email)`;

/**
 * Enrols contacts that triggered the automation AFTER it went live (never the pre-existing audience: switching a flow
 * on must not mail an old list). Eligible = subscribed and not suppressed. Idempotent via UNIQUE(automation, contact).
 */
export async function enrollByTrigger(
  db: Database,
  organizationId: OrganizationId,
  automation: Pick<Automation, "id" | "trigger" | "activatedAt">,
  firstStepId: string,
  now: Date,
) {
  if (!automation.activatedAt) return 0;
  const t = automation.trigger;
  const ins = sql`insert into automation_enrollments (organization_id, automation_id, contact_id, current_step_id, next_run_at)`;
  const tail = sql`on conflict do nothing`;
  const since = automation.activatedAt;
  let res;
  if (t.type === "contact_created")
    res = await db.execute(sql`${ins}
      select c.organization_id, ${automation.id}::uuid, c.id, ${firstStepId}, ${now}
        from contacts c where ${ELIGIBLE(organizationId)} and c.created_at >= ${since} ${tail}`);
  else if (t.type === "list_joined")
    res = await db.execute(sql`${ins}
      select c.organization_id, ${automation.id}::uuid, c.id, ${firstStepId}, ${now}
        from contacts c join list_contacts lc on lc.contact_id = c.id and lc.organization_id = c.organization_id
       where ${ELIGIBLE(organizationId)} and lc.list_id = ${t.listId}::uuid and lc.added_at >= ${since} ${tail}`);
  else if (t.type === "tag_added")
    res = await db.execute(sql`${ins}
      select c.organization_id, ${automation.id}::uuid, c.id, ${firstStepId}, ${now}
        from contacts c join contact_tags ct on ct.contact_id = c.id and ct.organization_id = c.organization_id
       where ${ELIGIBLE(organizationId)} and ct.tag_id = ${t.tagId}::uuid and ct.added_at >= ${since} ${tail}`);
  else return 0;
  return res.rowCount ?? 0;
}

/** Manual enrolment of the contacts matching a filter (bounded). Same eligibility rules. */
export async function enrollContacts(
  db: Database,
  organizationId: OrganizationId,
  automationId: string,
  filter: ContactFilter,
  firstStepId: string,
  now: Date,
  max = 5000,
) {
  const res = await db.execute(sql`
    insert into automation_enrollments (organization_id, automation_id, contact_id, current_step_id, next_run_at)
    select contacts.organization_id, ${automationId}::uuid, contacts.id, ${firstStepId}, ${now}
      from contacts
     where ${contactWhere(organizationId, { ...filter, status: "subscribed" })}
       and not exists (select 1 from suppressions s where s.organization_id = contacts.organization_id and s.email = contacts.email)
     order by contacts.created_at
     limit ${max}
    on conflict do nothing`);
  return res.rowCount ?? 0;
}

/** Cross-tenant: the engine processes every organization's active automations. */
export async function listActiveAutomations(
  db: Database,
  limit = 200,
  scope: { organizationId?: string } = {},
  afterId?: string,
) {
  return db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.status, "active"),
        scope.organizationId
          ? eq(automations.organizationId, scope.organizationId)
          : undefined,
        afterId ? gt(automations.id, afterId) : undefined,
      ),
    )
    .orderBy(automations.id)
    .limit(limit);
}

export const ENROLLMENT_LEASE_MS = 5 * 60_000;

/**
 * Cross-tenant claim of due enrolments of ACTIVE automations. The claim is a lease: the row's next_run_at is pushed
 * out, so a worker that crashes mid-way simply has the enrolment retried later, and two workers never take the same
 * row (`FOR UPDATE SKIP LOCKED` inside the claiming statement).
 */
export async function claimDueEnrollments(
  db: Database,
  now: Date,
  limit: number,
  scope: { organizationId?: string } = {},
): Promise<AutomationEnrollment[]> {
  const org = scope.organizationId
    ? sql`and e2.organization_id = ${scope.organizationId}::uuid`
    : sql``;
  const lease = new Date(now.getTime() + ENROLLMENT_LEASE_MS);
  const res = await db.execute<{ id: string }>(sql`
    update automation_enrollments e set next_run_at = ${lease}
     where e.id in (
       select e2.id from automation_enrollments e2 join automations a on a.id = e2.automation_id
        where e2.status = 'active' and e2.next_run_at <= ${now} and a.status = 'active' ${org}
        order by e2.next_run_at limit ${limit}
        for update of e2 skip locked)
    returning e.id`);
  return res.rows.length === 0
    ? []
    : db
        .select()
        .from(automationEnrollments)
        .where(
          inArray(
            automationEnrollments.id,
            res.rows.map((r) => r.id),
          ),
        );
}

export async function updateEnrollment(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  patch: Partial<
    Pick<
      AutomationEnrollment,
      | "status"
      | "currentStepId"
      | "nextRunAt"
      | "lastRecipientId"
      | "finishedAt"
      | "exitReason"
    >
  >,
) {
  await db
    .update(automationEnrollments)
    .set(patch)
    .where(
      and(
        eq(automationEnrollments.organizationId, organizationId),
        eq(automationEnrollments.id, id),
      ),
    );
}

/** Queues one email for a contact in a step campaign; null if that contact already got this step. */
export async function queueAutomationRecipient(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  contactId: string,
  email: string,
  now: Date,
) {
  const [row] = await db
    .insert(campaignRecipients)
    .values({ organizationId, campaignId, contactId, email, nextAttemptAt: now })
    .onConflictDoNothing()
    .returning({ id: campaignRecipients.id });
  return row?.id ?? null;
}

export async function contactHasTag(
  db: Database,
  organizationId: OrganizationId,
  contactId: string,
  tagId: string,
) {
  const r = await db.execute(
    sql`select 1 from contact_tags where organization_id = ${organizationId}::uuid and contact_id = ${contactId}::uuid and tag_id = ${tagId}::uuid`,
  );
  return r.rows.length > 0;
}
export async function contactInList(
  db: Database,
  organizationId: OrganizationId,
  contactId: string,
  listId: string,
) {
  const r = await db.execute(
    sql`select 1 from list_contacts where organization_id = ${organizationId}::uuid and contact_id = ${contactId}::uuid and list_id = ${listId}::uuid`,
  );
  return r.rows.length > 0;
}

export async function enrollmentCounts(
  db: Database,
  organizationId: OrganizationId,
  automationId: string,
) {
  const rows = await db
    .select({ status: automationEnrollments.status, n: sql<number>`count(*)::int` })
    .from(automationEnrollments)
    .where(
      and(
        eq(automationEnrollments.organizationId, organizationId),
        eq(automationEnrollments.automationId, automationId),
      ),
    )
    .groupBy(automationEnrollments.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function exitReasons(
  db: Database,
  organizationId: OrganizationId,
  automationId: string,
) {
  const r = await db.execute<{ reason: string | null; n: number }>(sql`
    select exit_reason as reason, count(*)::int as n from automation_enrollments
     where organization_id = ${organizationId}::uuid and automation_id = ${automationId}::uuid and status = 'exited'
     group by 1 order by 2 desc`);
  return r.rows.map((x) => ({ reason: x.reason ?? "unknown", n: x.n }));
}

export async function findAutomationRecipient(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  contactId: string,
) {
  const [row] = await db
    .select({ id: campaignRecipients.id })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.organizationId, organizationId),
        eq(campaignRecipients.campaignId, campaignId),
        eq(campaignRecipients.contactId, contactId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Cross-tenant: loads the (active) automations behind a batch of claimed enrolments. */
export async function getActiveAutomationsByIds(db: Database, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(automations)
    .where(and(inArray(automations.id, ids), eq(automations.status, "active")));
}
