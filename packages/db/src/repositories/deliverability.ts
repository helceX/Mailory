import { and, eq, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { contacts } from "../schema/index";
import { contactWhere, type ContactFilter } from "./contacts";

export const ENGAGEMENT_WINDOW_DAYS = 90;

/**
 * Recomputes engagement for contacts mailed in the last 90 days (formula mirrors `engagementScore` in core, which has
 * the unit tests; the integration test pins them together), and clears the score of contacts that have gone quiet in
 * the window. Cross-tenant by design (nightly job); `scope` narrows it for tests and per-org refreshes.
 */
export async function refreshEngagement(
  db: Database,
  now: Date,
  scope: { organizationId?: string } = {},
) {
  const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * 86_400_000);
  const orgFilter = scope.organizationId
    ? sql`and r.organization_id = ${scope.organizationId}::uuid`
    : sql``;
  const cOrg = scope.organizationId
    ? sql`and c.organization_id = ${scope.organizationId}::uuid`
    : sql``;
  const updated = await db.execute(sql`
    with agg as (
      select r.contact_id, r.organization_id,
             count(*)::int as sent,
             count(*) filter (where r.opened_at is not null)::int as opened,
             count(*) filter (where r.clicked_at is not null)::int as clicked,
             max(greatest(r.opened_at, r.clicked_at)) as last_act
        from campaign_recipients r
       where r.sent_at >= ${since} and r.contact_id is not null ${orgFilter}
       group by r.contact_id, r.organization_id)
    update contacts c
       set engagement_score = case when agg.sent < 3 then null else
             round(100 * (0.5 * least(1.0, agg.opened::numeric / agg.sent)
                        + 0.5 * least(1.0, agg.clicked::numeric / agg.sent * 3)))::smallint end,
           last_activity_at = coalesce(agg.last_act, c.last_activity_at)
      from agg
     where c.id = agg.contact_id and c.organization_id = agg.organization_id`);
  const cleared = await db.execute(sql`
    update contacts c set engagement_score = null
     where c.engagement_score is not null ${cOrg}
       and not exists (select 1 from campaign_recipients r
                        where r.contact_id = c.id and r.sent_at >= ${since})`);
  return { updated: updated.rowCount ?? 0, cleared: cleared.rowCount ?? 0 };
}

/** Engagement mix of who a campaign would reach (same eligibility as the send). */
export async function audienceEngagement(
  db: Database,
  organizationId: OrganizationId,
  filter: ContactFilter,
) {
  const [row] = await db
    .select({
      size: sql<number>`count(*)::int`,
      scored: sql<number>`count(${contacts.engagementScore})::int`,
      cold: sql<number>`count(*) filter (where ${contacts.engagementScore} > 0 and ${contacts.engagementScore} < 30)::int`,
      dormant: sql<number>`count(*) filter (where ${contacts.engagementScore} = 0)::int`,
    })
    .from(contacts)
    .where(
      and(
        contactWhere(organizationId, { ...filter, status: "subscribed" }),
        sql`not exists (select 1 from suppressions s where s.organization_id = ${organizationId}::uuid and s.email = ${contacts.email})`,
      ),
    );
  return row ?? { size: 0, scored: 0, cold: 0, dormant: 0 };
}

/** List health overview for the Deliverability Center. */
export async function listHealth(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      subscribed: sql<number>`count(*) filter (where ${contacts.status} = 'subscribed')::int`,
      unsubscribed: sql<number>`count(*) filter (where ${contacts.status} = 'unsubscribed')::int`,
      bounced: sql<number>`count(*) filter (where ${contacts.status} = 'bounced')::int`,
      complained: sql<number>`count(*) filter (where ${contacts.status} = 'complained')::int`,
      hot: sql<number>`count(*) filter (where ${contacts.engagementScore} >= 60)::int`,
      warm: sql<number>`count(*) filter (where ${contacts.engagementScore} >= 30 and ${contacts.engagementScore} < 60)::int`,
      cold: sql<number>`count(*) filter (where ${contacts.engagementScore} > 0 and ${contacts.engagementScore} < 30)::int`,
      dormant: sql<number>`count(*) filter (where ${contacts.engagementScore} = 0)::int`,
      unscored: sql<number>`count(*) filter (where ${contacts.engagementScore} is null and ${contacts.status} = 'subscribed')::int`,
      noConsent: sql<number>`count(*) filter (where ${contacts.status} = 'subscribed' and ${contacts.consentStatus} <> 'granted')::int`,
    })
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId));
  return row!;
}

// ---- list cleanup ("sunset") -----------------------------------------------------------------------------------

/** Subscribed contacts who were mailed 3+ times in the last 90 days and reacted to none (score 0), excluding new ones. */
const CANDIDATES = sql`status = 'subscribed' and engagement_score = 0 and created_at < now() - interval '60 days'`;

export async function countCleanupCandidates(
  db: Database,
  organizationId: OrganizationId,
) {
  const [r] = await db
    .execute<{ candidates: number; cleaned: number }>(
      sql`
    select count(*) filter (where ${CANDIDATES})::int as candidates,
           count(*) filter (where status = 'cleaned')::int as cleaned
      from contacts where organization_id = ${organizationId}::uuid`,
    )
    .then((x) => x.rows);
  return r ?? { candidates: 0, cleaned: 0 };
}

/** Retires the candidates (status → cleaned). Reversible: nothing is deleted and no opt-out is recorded. */
export async function cleanDormantContacts(
  db: Database,
  organizationId: OrganizationId,
) {
  const r = await db.execute(sql`
    update contacts set status = 'cleaned', updated_at = now()
     where organization_id = ${organizationId}::uuid and ${CANDIDATES}`);
  return r.rowCount ?? 0;
}

/** Brings cleaned contacts back (oldest first), at most `limit`, never one that is suppressed. Returns how many. */
export async function restoreCleanedContacts(
  db: Database,
  organizationId: OrganizationId,
  limit: number,
) {
  if (limit <= 0) return 0;
  const r = await db.execute(sql`
    update contacts set status = 'subscribed', engagement_score = null, updated_at = now()
     where id in (
       select c.id from contacts c
        where c.organization_id = ${organizationId}::uuid and c.status = 'cleaned'
          and not exists (select 1 from suppressions s where s.organization_id = c.organization_id and s.email = c.email)
        order by c.created_at limit ${limit})`);
  return r.rowCount ?? 0;
}
