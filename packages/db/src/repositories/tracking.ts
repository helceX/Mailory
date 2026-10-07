import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { campaignLinks } from "../schema/index";

export const MAX_LINKS_PER_CAMPAIGN = 200;

/**
 * Registers the destination URLs of a campaign (idempotent) and returns url → link id. URLs beyond the per-campaign cap
 * are simply not returned and stay untracked, so per-recipient URLs cannot grow the table without bound.
 */
export async function ensureCampaignLinks(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  urls: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(urls)];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const existing = await db
    .select({ id: campaignLinks.id, url: campaignLinks.url })
    .from(campaignLinks)
    .where(
      and(
        eq(campaignLinks.organizationId, organizationId),
        eq(campaignLinks.campaignId, campaignId),
      ),
    );
  for (const r of existing) out.set(r.url, r.id);
  const missing = wanted.filter((u) => !out.has(u));
  const room = Math.max(0, MAX_LINKS_PER_CAMPAIGN - existing.length);
  const toAdd = missing.slice(0, room);
  if (toAdd.length > 0) {
    await db
      .insert(campaignLinks)
      .values(toAdd.map((url) => ({ organizationId, campaignId, url })))
      .onConflictDoNothing();
    const added = await db
      .select({ id: campaignLinks.id, url: campaignLinks.url })
      .from(campaignLinks)
      .where(
        and(
          eq(campaignLinks.organizationId, organizationId),
          eq(campaignLinks.campaignId, campaignId),
          inArray(campaignLinks.url, toAdd),
        ),
      );
    for (const r of added) out.set(r.url, r.id);
  }
  return new Map(wanted.filter((u) => out.has(u)).map((u) => [u, out.get(u)!]));
}

export async function getLinkUrl(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  linkId: string,
) {
  const [row] = await db
    .select({ url: campaignLinks.url })
    .from(campaignLinks)
    .where(
      and(
        eq(campaignLinks.organizationId, organizationId),
        eq(campaignLinks.campaignId, campaignId),
        eq(campaignLinks.id, linkId),
      ),
    )
    .limit(1);
  return row?.url ?? null;
}

export type TrackingInput = {
  campaignId: string;
  recipientId: string;
  linkId?: string | null;
  type: "open" | "click";
  device: string;
  ipHash: string | null;
  isBot: boolean;
  at: Date;
};

/**
 * Records one interaction for a recipient that really belongs to this organization and campaign (a forged token for
 * another tenant's ids inserts nothing). Genuine events also stamp the recipient's first open/click; a click implies an
 * open. Returns the recipient's send time (for bot heuristics) via `recipientSentAt` helper below.
 */
export async function recordTracking(
  db: Database,
  organizationId: OrganizationId,
  e: TrackingInput,
) {
  const res = await db.execute(sql`
    insert into tracking_events (organization_id, campaign_id, recipient_id, link_id, type, occurred_at, device, ip_hash, is_bot)
    select r.organization_id, r.campaign_id, r.id, ${e.linkId ?? null}::uuid, ${e.type}, ${e.at}, ${e.device}, ${e.ipHash}, ${e.isBot}
      from campaign_recipients r
     where r.id = ${e.recipientId}::uuid and r.organization_id = ${organizationId}::uuid and r.campaign_id = ${e.campaignId}::uuid`);
  if ((res.rowCount ?? 0) === 0) return false;
  if (!e.isBot) {
    await db.execute(sql`
      update campaign_recipients
         set opened_at = coalesce(opened_at, ${e.at}),
             clicked_at = case when ${e.type} = 'click' then coalesce(clicked_at, ${e.at}) else clicked_at end
       where id = ${e.recipientId}::uuid and organization_id = ${organizationId}::uuid`);
  }
  return true;
}

export async function recipientSentAt(
  db: Database,
  organizationId: OrganizationId,
  recipientId: string,
) {
  const r = await db.execute<{ sent_at: Date | null; campaign_id: string }>(
    sql`select sent_at, campaign_id from campaign_recipients where id = ${recipientId}::uuid and organization_id = ${organizationId}::uuid`,
  );
  const row = r.rows[0];
  return row
    ? {
        sentAt: row.sent_at ? new Date(row.sent_at) : null,
        campaignId: row.campaign_id,
      }
    : null;
}

// ---- analytics -----------------------------------------------------------------------------------

export type CampaignStats = {
  recipients: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  unsubscribed: number;
  uniqueOpens: number;
  uniqueClicks: number;
  totalOpens: number;
  totalClicks: number;
};

const STATS_SELECT = sql`
  count(*)::int as recipients,
  count(*) filter (where r.sent_at is not null)::int as sent,
  count(*) filter (where r.delivered_at is not null or r.status = 'delivered')::int as delivered,
  count(*) filter (where r.status = 'bounced')::int as bounced,
  count(*) filter (where r.status = 'complained')::int as complained,
  count(*) filter (where r.status = 'failed')::int as failed,
  count(*) filter (where r.unsubscribed_at is not null)::int as unsubscribed,
  count(*) filter (where r.opened_at is not null)::int as unique_opens,
  count(*) filter (where r.clicked_at is not null)::int as unique_clicks`;

type StatsRow = Record<string, number>;
const toStats = (
  r: StatsRow | undefined,
  totals: { opens: number; clicks: number },
): CampaignStats => ({
  recipients: r?.recipients ?? 0,
  sent: r?.sent ?? 0,
  delivered: r?.delivered ?? 0,
  bounced: r?.bounced ?? 0,
  complained: r?.complained ?? 0,
  failed: r?.failed ?? 0,
  unsubscribed: r?.unsubscribed ?? 0,
  uniqueOpens: r?.unique_opens ?? 0,
  uniqueClicks: r?.unique_clicks ?? 0,
  totalOpens: totals.opens,
  totalClicks: totals.clicks,
});

export async function campaignStats(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
): Promise<CampaignStats> {
  const [agg, tot] = await Promise.all([
    db.execute<StatsRow>(
      sql`select ${STATS_SELECT} from campaign_recipients r where r.organization_id = ${organizationId}::uuid and r.campaign_id = ${campaignId}::uuid`,
    ),
    db.execute<{ opens: number; clicks: number }>(sql`
      select count(*) filter (where type = 'open')::int as opens, count(*) filter (where type = 'click')::int as clicks
        from tracking_events where organization_id = ${organizationId}::uuid and campaign_id = ${campaignId}::uuid and not is_bot`),
  ]);
  return toStats(agg.rows[0], tot.rows[0] ?? { opens: 0, clicks: 0 });
}

export async function topLinks(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
  limit = 10,
) {
  const r = await db.execute<{
    url: string;
    clicks: number;
    unique_clicks: number;
  }>(sql`
    select l.url, count(*)::int as clicks, count(distinct e.recipient_id)::int as unique_clicks
      from tracking_events e join campaign_links l on l.id = e.link_id
     where e.organization_id = ${organizationId}::uuid and e.campaign_id = ${campaignId}::uuid
       and e.type = 'click' and not e.is_bot
     group by l.url order by clicks desc, l.url limit ${limit}`);
  return r.rows.map((x) => ({
    url: x.url,
    clicks: x.clicks,
    uniqueClicks: x.unique_clicks,
  }));
}

/** Genuine opens/clicks per hour (UTC), oldest first, capped to the first 14 days after the first event. */
export async function engagementTimeline(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
) {
  const r = await db.execute<{ bucket: Date; opens: number; clicks: number }>(sql`
    select date_trunc('hour', occurred_at) as bucket,
           count(*) filter (where type = 'open')::int as opens,
           count(*) filter (where type = 'click')::int as clicks
      from tracking_events
     where organization_id = ${organizationId}::uuid and campaign_id = ${campaignId}::uuid and not is_bot
     group by 1 order by 1 limit 336`);
  return r.rows.map((x) => ({
    bucket: new Date(x.bucket),
    opens: x.opens,
    clicks: x.clicks,
  }));
}

export type CampaignComparisonRow = CampaignStats & {
  id: string;
  name: string;
  subject: string;
  status: string;
  startedAt: Date | null;
};

/** One grouped query for the analytics table: recent campaigns that have started sending. */
export async function compareCampaigns(
  db: Database,
  organizationId: OrganizationId,
  limit = 50,
): Promise<CampaignComparisonRow[]> {
  const r = await db.execute<
    StatsRow & {
      id: string;
      name: string;
      subject: string;
      status: string;
      started_at: Date | null;
      total_opens: number;
      total_clicks: number;
    }
  >(sql`
    select c.id, c.name, c.subject, c.status, c.started_at, ${STATS_SELECT},
           coalesce((select count(*) from tracking_events e where e.campaign_id = c.id and e.type = 'open' and not e.is_bot), 0)::int as total_opens,
           coalesce((select count(*) from tracking_events e where e.campaign_id = c.id and e.type = 'click' and not e.is_bot), 0)::int as total_clicks
      from campaigns c
      left join campaign_recipients r on r.campaign_id = c.id
     where c.organization_id = ${organizationId}::uuid and c.started_at is not null and c.kind = 'campaign'
     group by c.id
     order by c.started_at desc
     limit ${limit}`);
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    subject: x.subject,
    status: x.status,
    startedAt: x.started_at ? new Date(x.started_at) : null,
    ...toStats(x, { opens: x.total_opens, clicks: x.total_clicks }),
  }));
}

/** Organization-wide totals for campaigns started since `since`. */
export async function orgOverview(
  db: Database,
  organizationId: OrganizationId,
  since: Date,
) {
  const r = await db.execute<
    StatsRow & { campaigns: number; total_opens: number; total_clicks: number }
  >(sql`
    select count(distinct c.id) filter (where c.kind = 'campaign')::int as campaigns, ${STATS_SELECT},
           coalesce((select count(*) from tracking_events e join campaigns c2 on c2.id = e.campaign_id where e.organization_id = ${organizationId}::uuid and c2.started_at >= ${since} and e.type = 'open' and not e.is_bot), 0)::int as total_opens,
           coalesce((select count(*) from tracking_events e join campaigns c2 on c2.id = e.campaign_id where e.organization_id = ${organizationId}::uuid and c2.started_at >= ${since} and e.type = 'click' and not e.is_bot), 0)::int as total_clicks
      from campaigns c join campaign_recipients r on r.campaign_id = c.id
     where c.organization_id = ${organizationId}::uuid and c.started_at >= ${since}`);
  const row = r.rows[0];
  return {
    campaigns: row?.campaigns ?? 0,
    ...toStats(row, { opens: row?.total_opens ?? 0, clicks: row?.total_clicks ?? 0 }),
  };
}
