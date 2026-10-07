import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { campaigns, contacts, organizations } from "../schema/index";
import type { Campaign } from "../schema/index";
import { contactWhere, type ContactFilter } from "./contacts";

export type CampaignDraftValues = Partial<
  Pick<
    Campaign,
    | "name"
    | "subject"
    | "preheader"
    | "senderIdentityId"
    | "replyTo"
    | "templateId"
    | "audience"
    | "utm"
    | "trackOpens"
    | "trackClicks"
  >
>;

export async function createCampaign(
  db: Database,
  organizationId: OrganizationId,
  input: Required<Pick<Campaign, "name" | "utm">> &
    CampaignDraftValues & { createdByUserId: string | null },
) {
  const [row] = await db
    .insert(campaigns)
    .values({ ...input, organizationId })
    .returning();
  return row!;
}

export async function getCampaign(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.organizationId, organizationId), eq(campaigns.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listCampaigns(
  db: Database,
  organizationId: OrganizationId,
  options: { status?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        options.status ? eq(campaigns.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
    .limit(Math.min(options.limit ?? 200, 500));
}

/** Edits a DRAFT only; null when the campaign is missing or no longer a draft (checked in the same statement). */
export async function updateCampaignDraft(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  patch: CampaignDraftValues,
) {
  const [row] = await db
    .update(campaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, id),
        eq(campaigns.status, "draft"),
      ),
    )
    .returning();
  return row ?? null;
}

export type CampaignTransitionPatch = Partial<
  Pick<
    Campaign,
    | "status"
    | "templateVersionId"
    | "snapshot"
    | "scheduledAt"
    | "startedAt"
    | "completedAt"
    | "submittedByUserId"
    | "submittedAt"
    | "approvedByUserId"
    | "approvedAt"
    | "rejectionReason"
  >
>;

/**
 * Compare-and-set on status: applies `patch` only if the campaign is currently in one of `from`, so two admins
 * racing (approve vs. cancel) cannot both win. Returns null when the precondition no longer holds.
 */
export async function transitionCampaign(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  from: string[],
  patch: CampaignTransitionPatch & { status: string },
) {
  const [row] = await db
    .update(campaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, id),
        inArray(campaigns.status, from),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteCampaignDraft(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.id, id),
        eq(campaigns.status, "draft"),
      ),
    )
    .returning({ id: campaigns.id });
  return rows.length > 0;
}

/**
 * Who a send to this audience would actually reach: subscribed contacts that are not suppressed. The same predicate
 * the Phase 8 recipient materialiser must use, so the number shown here is the number sent to.
 */
export async function countSendable(
  db: Database,
  organizationId: OrganizationId,
  filter: ContactFilter,
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(
      and(
        contactWhere(organizationId, { ...filter, status: "subscribed" }),
        sql`not exists (select 1 from suppressions s where s.organization_id = ${organizationId}::uuid and s.email = ${contacts.email})`,
      ),
    );
  return row?.n ?? 0;
}

export async function getCampaignPolicy(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select({ requireApproval: organizations.requireCampaignApproval })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return { requireApproval: row?.requireApproval ?? false };
}

export async function setCampaignPolicy(
  db: Database,
  organizationId: OrganizationId,
  requireApproval: boolean,
) {
  await db
    .update(organizations)
    .set({ requireCampaignApproval: requireApproval, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
}
