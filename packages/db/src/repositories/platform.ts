import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { slugify } from "@mailory/core/shared";
import type { Database, OrganizationId } from "../index";
import { organizations, sharedTemplates } from "../schema/index";

/** Aggregate-only columns shared by the platform and partner views. NEVER content: no contact, campaign or report data. */
const METRICS = sql`
  o.id, o.name, o.type, o.parent_organization_id, o.suspended_at, o.suspended_reason, o.created_at, o.daily_send_limit,
  coalesce((select s.plan_key from subscriptions s where s.organization_id = o.id and s.status in ('active','trialing')), 'free') as plan_key,
  (select s.source from subscriptions s where s.organization_id = o.id) as source,
  (select count(*) from memberships m where m.organization_id = o.id and m.status = 'active')::int as members,
  (select count(*) from contacts c where c.organization_id = o.id)::int as contacts,
  (select count(*) from campaign_recipients r where r.organization_id = o.id and r.sent_at >= date_trunc('month', now() at time zone 'utc'))::int as sent_this_month,
  (select max(c.started_at) from campaigns c where c.organization_id = o.id and c.kind = 'campaign') as last_sent_at,
  exists (select 1 from sender_domains d where d.organization_id = o.id and d.status = 'verified') as domain_verified,
  exists (select 1 from templates t where t.organization_id = o.id) as has_template,
  exists (select 1 from campaigns c where c.organization_id = o.id and c.kind = 'campaign' and c.started_at is not null) as has_sent`;

export type OrgMetrics = {
  id: string;
  name: string;
  type: string;
  parentOrganizationId: string | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  createdAt: Date;
  dailySendLimit: number;
  planKey: string;
  source: string | null;
  members: number;
  contacts: number;
  sentThisMonth: number;
  lastSentAt: Date | null;
  domainVerified: boolean;
  hasTemplate: boolean;
  hasSent: boolean;
};

type Raw = Record<string, unknown>;
const map = (r: Raw): OrgMetrics => ({
  id: r.id as string,
  name: r.name as string,
  type: r.type as string,
  parentOrganizationId: (r.parent_organization_id as string | null) ?? null,
  suspendedAt: r.suspended_at ? new Date(r.suspended_at as string) : null,
  suspendedReason: (r.suspended_reason as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  dailySendLimit: r.daily_send_limit as number,
  planKey: r.plan_key as string,
  source: (r.source as string | null) ?? null,
  members: r.members as number,
  contacts: r.contacts as number,
  sentThisMonth: r.sent_this_month as number,
  lastSentAt: r.last_sent_at ? new Date(r.last_sent_at as string) : null,
  domainVerified: Boolean(r.domain_verified),
  hasTemplate: Boolean(r.has_template),
  hasSent: Boolean(r.has_sent),
});

/** Platform-wide listing (platform admins only; enforced by the service). */
export async function listOrganizationsOverview(
  db: Database,
  options: { q?: string; limit?: number } = {},
) {
  const q = options.q?.trim();
  const r = await db.execute<Raw>(sql`
    select ${METRICS} from organizations o
     where o.deleted_at is null ${q ? sql`and lower(o.name) like ${`%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`} escape '\\'` : sql``}
     order by o.created_at desc limit ${Math.min(options.limit ?? 100, 500)}`);
  return r.rows.map(map);
}

export async function getOrganizationMetrics(
  db: Database,
  organizationId: OrganizationId,
) {
  const r = await db.execute<Raw>(
    sql`select ${METRICS} from organizations o where o.id = ${organizationId}::uuid and o.deleted_at is null`,
  );
  return r.rows[0] ? map(r.rows[0]) : null;
}

/** Children of a partner. The parent id is part of the WHERE, so a partner can never reach an org that is not its own. */
export async function listChildOrganizations(
  db: Database,
  organizationId: OrganizationId,
) {
  const r = await db.execute<Raw>(sql`
    select ${METRICS} from organizations o
     where o.parent_organization_id = ${organizationId}::uuid and o.deleted_at is null
     order by o.created_at desc limit 500`);
  return r.rows.map(map);
}

export async function getChildOrganization(
  db: Database,
  organizationId: OrganizationId,
  childId: string,
) {
  const r = await db.execute<Raw>(sql`
    select ${METRICS} from organizations o
     where o.id = ${childId}::uuid and o.parent_organization_id = ${organizationId}::uuid and o.deleted_at is null`);
  return r.rows[0] ? map(r.rows[0]) : null;
}

/** A workspace with no members yet: the future owner is invited by email and becomes its first (and only) owner. */
export async function createOrganizationWithoutOwner(
  db: Database,
  input: {
    name: string;
    type?: "standard" | "partner";
    parentOrganizationId?: string | null;
  },
) {
  const base = slugify(input.name) || "org";
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const [org] = await db
        .insert(organizations)
        .values({
          name: input.name,
          slug,
          type: input.type ?? "standard",
          parentOrganizationId: input.parentOrganizationId ?? null,
        })
        .returning();
      return org!;
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      if (e?.code !== "23505" && e?.cause?.code !== "23505") throw error;
    }
  }
  throw new Error("Could not allocate a unique organization slug");
}

export async function setSuspension(
  db: Database,
  organizationId: OrganizationId,
  reason: string | null,
  at: Date,
) {
  await db
    .update(organizations)
    .set(
      reason === null
        ? { suspendedAt: null, suspendedReason: null, updatedAt: at }
        : { suspendedAt: at, suspendedReason: reason, updatedAt: at },
    )
    .where(eq(organizations.id, organizationId));
}

export async function setDailySendLimit(
  db: Database,
  organizationId: OrganizationId,
  limit: number,
) {
  await db
    .update(organizations)
    .set({ dailySendLimit: limit, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
}

export async function setOrganizationKind(
  db: Database,
  organizationId: OrganizationId,
  input: { type: "standard" | "partner"; parentOrganizationId: string | null },
) {
  await db
    .update(organizations)
    .set({
      type: input.type,
      parentOrganizationId: input.parentOrganizationId,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

// ---- template hub ------------------------------------------------------------------------------------------------

export async function createSharedTemplate(
  db: Database,
  organizationId: OrganizationId,
  input: {
    name: string;
    category: string;
    description: string | null;
    doc: unknown;
    userId: string | null;
  },
) {
  const [row] = await db
    .insert(sharedTemplates)
    .values({
      partnerOrganizationId: organizationId,
      name: input.name,
      category: input.category,
      description: input.description,
      doc: input.doc,
      createdByUserId: input.userId,
    })
    .returning();
  return row!;
}

export async function listSharedTemplates(
  db: Database,
  organizationId: OrganizationId,
) {
  return db
    .select()
    .from(sharedTemplates)
    .where(
      and(
        eq(sharedTemplates.partnerOrganizationId, organizationId),
        isNull(sharedTemplates.archivedAt),
      ),
    )
    .orderBy(desc(sharedTemplates.createdAt));
}

export async function getSharedTemplate(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(sharedTemplates)
    .where(
      and(
        eq(sharedTemplates.partnerOrganizationId, organizationId),
        eq(sharedTemplates.id, id),
        isNull(sharedTemplates.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function archiveSharedTemplate(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .update(sharedTemplates)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(sharedTemplates.partnerOrganizationId, organizationId),
        eq(sharedTemplates.id, id),
        isNull(sharedTemplates.archivedAt),
      ),
    )
    .returning({ id: sharedTemplates.id });
  return rows.length > 0;
}

/** Workspaces closed by their owners and still inside the grace period (platform admins can restore them). */
export async function listDeletedOrganizations(db: Database) {
  const r = await db.execute<{ id: string; name: string; deleted_at: string }>(sql`
    select id, name, deleted_at from organizations where deleted_at is not null order by deleted_at desc limit 100`);
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    deletedAt: new Date(x.deleted_at),
  }));
}
