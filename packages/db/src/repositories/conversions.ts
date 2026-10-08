import { sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";

export const ATTRIBUTION_WINDOW_DAYS = 30;

export type ConversionInput = {
  name: string;
  email: string | null;
  contactId: string | null;
  value: number;
  currency: string;
  occurredAt: Date;
  externalId: string | null;
};

/**
 * Records an outcome and attributes it ONCE, at recording time: the most recent campaign email the person CLICKED
 * before converting (inside the window), otherwise the most recent one merely SENT to them. The two are kept apart
 * (`attribution`) so reports can show the strong signal separately from mere influence. Retried calls with the same
 * `externalId` return the original row instead of double counting.
 */
export async function recordConversion(
  db: Database,
  organizationId: OrganizationId,
  input: ConversionInput,
) {
  const org = sql`${organizationId}::uuid`;
  if (input.externalId) {
    const dup = await db.execute<{
      id: string;
      campaign_id: string | null;
      attribution: string | null;
    }>(
      sql`select id, campaign_id, attribution from conversions where organization_id = ${org} and external_id = ${input.externalId}`,
    );
    const hit = dup.rows[0];
    if (hit)
      return {
        id: hit.id,
        created: false,
        campaignId: hit.campaign_id,
        attribution: hit.attribution,
      };
  }
  const email = input.email?.trim().toLowerCase() || null;
  let contactId = input.contactId;
  if (!contactId && email) {
    const c = await db.execute<{ id: string }>(
      sql`select id from contacts where organization_id = ${org} and email = ${email} limit 1`,
    );
    contactId = c.rows[0]?.id ?? null;
  }
  const since = new Date(
    input.occurredAt.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000,
  );
  let touch: { id: string; campaign_id: string; clicked: boolean } | undefined;
  if (contactId || email) {
    const who = contactId
      ? sql`(r.contact_id = ${contactId}::uuid ${email ? sql`or r.email = ${email}` : sql``})`
      : sql`r.email = ${email}`;
    const r = await db.execute<{
      id: string;
      campaign_id: string;
      clicked: boolean;
    }>(sql`
      select r.id, r.campaign_id,
             (r.clicked_at is not null and r.clicked_at <= ${input.occurredAt}) as clicked
        from campaign_recipients r
       where r.organization_id = ${org} and ${who}
         and r.sent_at is not null and r.sent_at <= ${input.occurredAt} and r.sent_at >= ${since}
       order by (r.clicked_at is not null and r.clicked_at <= ${input.occurredAt}) desc,
                coalesce(case when r.clicked_at <= ${input.occurredAt} then r.clicked_at end, r.sent_at) desc
       limit 1`);
    touch = r.rows[0];
  }
  const attribution = touch ? (touch.clicked ? "click" : "send") : null;
  const ins = await db.execute<{ id: string }>(sql`
    insert into conversions (organization_id, name, email, contact_id, campaign_id, recipient_id, attribution, value, currency, external_id, occurred_at)
    values (${org}, ${input.name}, ${email}, ${contactId}::uuid, ${touch?.campaign_id ?? null}::uuid, ${touch?.id ?? null}::uuid,
            ${attribution}, ${input.value.toFixed(2)}::numeric, ${input.currency}, ${input.externalId}, ${input.occurredAt})
    on conflict (organization_id, external_id) where external_id is not null do nothing
    returning id`);
  if (ins.rows.length === 0) {
    // Lost a race with a concurrent retry of the same externalId.
    const again = await db.execute<{
      id: string;
      campaign_id: string | null;
      attribution: string | null;
    }>(
      sql`select id, campaign_id, attribution from conversions where organization_id = ${org} and external_id = ${input.externalId}`,
    );
    const hit = again.rows[0]!;
    return {
      id: hit.id,
      created: false,
      campaignId: hit.campaign_id,
      attribution: hit.attribution,
    };
  }
  return {
    id: ins.rows[0]!.id,
    created: true,
    campaignId: touch?.campaign_id ?? null,
    attribution,
  };
}

export type ConversionStats = {
  total: number;
  people: number;
  revenue: number;
  viaClick: number;
  byName: { name: string; count: number; value: number; viaClick: number }[];
};

export async function conversionStats(
  db: Database,
  organizationId: OrganizationId,
  campaignId: string,
): Promise<ConversionStats> {
  const r = await db.execute<{
    name: string;
    n: number;
    people: number;
    v: string;
    clicks: number;
  }>(sql`
    select name, count(*)::int as n,
           count(distinct coalesce(contact_id::text, email))::int as people,
           coalesce(sum(value), 0)::text as v,
           count(*) filter (where attribution = 'click')::int as clicks
      from conversions
     where organization_id = ${organizationId}::uuid and campaign_id = ${campaignId}::uuid
     group by name order by n desc, name`);
  const people = await db.execute<{ n: number }>(sql`
    select count(distinct coalesce(contact_id::text, email))::int as n from conversions
     where organization_id = ${organizationId}::uuid and campaign_id = ${campaignId}::uuid`);
  return {
    total: r.rows.reduce((a, x) => a + x.n, 0),
    people: people.rows[0]?.n ?? 0,
    revenue: r.rows.reduce((a, x) => a + Number(x.v), 0),
    viaClick: r.rows.reduce((a, x) => a + x.clicks, 0),
    byName: r.rows.map((x) => ({
      name: x.name,
      count: x.n,
      value: Number(x.v),
      viaClick: x.clicks,
    })),
  };
}
