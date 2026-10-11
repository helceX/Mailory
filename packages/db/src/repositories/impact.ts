import { sql } from "drizzle-orm";
import { evaluateImpact, type ImpactGroup } from "@mailory/core";
import type { Database, OrganizationId } from "../index";
import { getCampaign } from "./campaigns";

/** Intention-to-treat: all assigned members remain in denominators, including failed/skipped sends. */
export async function campaignImpactReport(
  db: Database,
  org: OrganizationId,
  id: string,
  now = new Date(),
) {
  const campaign = await getCampaign(db, org, id);
  const config = campaign?.audience?.impact;
  if (!campaign || !config || !campaign.startedAt) return null;
  const endsAt = new Date(campaign.startedAt.getTime() + config.windowDays * 86400000);
  const until = new Date(Math.min(now.getTime(), endsAt.getTime()));
  const rows = await db.execute<{
    arm: string;
    assigned: number;
    converted: number;
    sent: number;
    contaminated: number;
    erased: number;
  }>(sql`
    with members as (
      select * from campaign_impact_members where organization_id = ${org}::uuid and campaign_id = ${id}::uuid
    ), outcomes as (
      select contact_id, email, occurred_at from conversions where organization_id = ${org}::uuid
        and name = ${config.goal} and occurred_at >= ${campaign.startedAt} and occurred_at < ${until}
    ), touches as (
      select contact_id, email, campaign_id, sent_at from campaign_recipients
      where organization_id = ${org}::uuid and sent_at >= ${campaign.startedAt} and sent_at < ${until}
    ), converted as (
      select m.id from members m join outcomes v on v.contact_id = m.contact_id and v.occurred_at >= m.assigned_at
      union select m.id from members m join outcomes v on v.email = m.email and v.occurred_at >= m.assigned_at
    ), contaminated as (
      select m.id from members m join touches r on r.contact_id = m.contact_id and r.campaign_id <> ${id}::uuid and r.sent_at >= m.assigned_at
      union select m.id from members m join touches r on r.email = m.email and r.campaign_id <> ${id}::uuid and r.sent_at >= m.assigned_at
    ), sent as (
      select distinct m.id from members m join touches r on r.email = m.email and r.campaign_id = ${id}::uuid and r.sent_at >= m.assigned_at
    )
    select m.arm, count(*)::int as assigned,
      count(v.id)::int as converted, count(s.id)::int as sent, count(r.id)::int as contaminated,
      count(*) filter (where m.contact_id is null)::int as erased
    from members m left join converted v on v.id = m.id left join contaminated r on r.id = m.id left join sent s on s.id = m.id
    group by m.arm`);
  const group = (arm: string): ImpactGroup =>
    rows.rows.find((r) => r.arm === arm) ?? {
      assigned: 0,
      converted: 0,
      sent: 0,
      contaminated: 0,
      erased: 0,
    };
  const treatment = group("treatment"),
    control = group("control");
  return {
    goal: config.goal,
    endsAt: endsAt.toISOString(),
    treatment,
    control,
    ...evaluateImpact(
      treatment,
      control,
      now >= endsAt,
      campaign.status === "completed",
    ),
  };
}
