import { sql, and, eq, isNotNull, desc } from "drizzle-orm";
import { campaigns } from "../schema/index";
import type { Database, OrganizationId } from "../index";
export type OutcomeSignal = {
  name: string;
  received: number;
  people: number;
  lastReceived: string;
};
/** Ingestion evidence only, never a claim that the customer's integration covers every outcome. */
export async function outcomeSignals(
  db: Database,
  org: OrganizationId,
  now = new Date(),
): Promise<OutcomeSignal[]> {
  const since = new Date(now.getTime() - 14 * 86400000);
  const rows = await db.execute<{
    name: string;
    received: number;
    people: number;
    last_received: Date;
  }>(sql`
    select name, count(*)::int as received,
      count(distinct coalesce(contact_id::text, email))::int as people,
      max(created_at) as last_received
    from conversions where organization_id = ${org}::uuid and created_at >= ${since} and created_at <= ${now}
    group by name order by max(created_at) desc, name limit 50`);
  return rows.rows.map((r) => ({
    name: r.name,
    received: r.received,
    people: r.people,
    lastReceived: new Date(r.last_received).toISOString(),
  }));
}
export async function recentImpactCampaigns(db: Database, org: OrganizationId) {
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, org),
        eq(campaigns.kind, "campaign"),
        isNotNull(campaigns.startedAt),
        sql`${campaigns.audience}->'impact' is not null`,
      ),
    )
    .orderBy(desc(campaigns.startedAt), desc(campaigns.id))
    .limit(3);
}
