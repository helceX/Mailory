import { and, eq, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { contacts, organizations } from "../schema/index";

/*
 * KVKK / GDPR building blocks: access (export), erasure, workspace deletion with a grace period, and retention.
 * Everything here is mechanical and idempotent; the service layer decides who may call it and writes the audit entry.
 */

export const RETENTION = {
  trackingDays: 25 * 30,
  botTrackingDays: 30,
  providerEventDays: 13 * 30,
  aiRequestDays: 13 * 30,
  authDebrisDays: 30,
  outboxDays: 30,
  webhookDeliveryDays: 30,
  apiUsageDays: 400,
  orgGraceDays: 30,
} as const;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Everything we hold about one person in one workspace (right of access). Internal hashes are left out. */
export async function exportContactData(
  db: Database,
  organizationId: OrganizationId,
  contactId: string,
) {
  const org = sql`${organizationId}::uuid`;
  const cid = sql`${contactId}::uuid`;
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)))
    .limit(1);
  if (!contact) return null;
  const rows = async <T>(q: ReturnType<typeof sql>) =>
    (await db.execute<T & Record<string, unknown>>(q)).rows;
  const [lists, tagRows, suppression, received, journeys, events] = await Promise.all([
    rows<{ name: string; added_at: string }>(
      sql`select l.name, lc.added_at from list_contacts lc join lists l on l.id = lc.list_id where lc.organization_id = ${org} and lc.contact_id = ${cid} order by l.name`,
    ),
    rows<{ name: string; added_at: string }>(
      sql`select t.name, ct.added_at from contact_tags ct join tags t on t.id = ct.tag_id where ct.organization_id = ${org} and ct.contact_id = ${cid} order by t.name`,
    ),
    rows<{ reason: string; created_at: string }>(
      sql`select reason, created_at from suppressions where organization_id = ${org} and email = ${contact.email}`,
    ),
    rows(sql`select c.name as campaign, c.subject, r.status, r.sent_at, r.delivered_at, r.opened_at, r.clicked_at, r.bounced_at, r.complained_at, r.unsubscribed_at
               from campaign_recipients r join campaigns c on c.id = r.campaign_id
              where r.organization_id = ${org} and r.contact_id = ${cid} order by r.created_at`),
    rows(
      sql`select a.name as automation, e.status, e.entered_at, e.finished_at, e.exit_reason from automation_enrollments e join automations a on a.id = e.automation_id where e.organization_id = ${org} and e.contact_id = ${cid} order by e.entered_at`,
    ),
    rows(
      sql`select t.type, t.occurred_at, t.device, t.is_bot from tracking_events t join campaign_recipients r on r.id = t.recipient_id where t.organization_id = ${org} and r.contact_id = ${cid} order by t.occurred_at`,
    ),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    contact: {
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      position: contact.position,
      website: contact.website,
      phone: contact.phone,
      sector: contact.sector,
      city: contact.city,
      status: contact.status,
      source: contact.source,
      custom: contact.custom,
      consent: {
        status: contact.consentStatus,
        source: contact.consentSource,
        at: iso(contact.consentAt),
      },
      createdAt: iso(contact.createdAt),
      unsubscribedAt: iso(contact.unsubscribedAt),
      engagementScore: contact.engagementScore,
    },
    lists: lists.map((l) => ({ name: l.name, addedAt: iso(l.added_at) })),
    tags: tagRows.map((t) => ({ name: t.name, addedAt: iso(t.added_at) })),
    suppression: suppression[0]
      ? { reason: suppression[0].reason, since: iso(suppression[0].created_at) }
      : null,
    emailsReceived: received.map((r) => ({
      campaign: r.campaign,
      subject: r.subject,
      status: r.status,
      sentAt: iso(r.sent_at),
      deliveredAt: iso(r.delivered_at),
      openedAt: iso(r.opened_at),
      clickedAt: iso(r.clicked_at),
      bouncedAt: iso(r.bounced_at),
      complainedAt: iso(r.complained_at),
      unsubscribedAt: iso(r.unsubscribed_at),
    })),
    automations: journeys.map((j) => ({
      automation: j.automation,
      status: j.status,
      enteredAt: iso(j.entered_at),
      finishedAt: iso(j.finished_at),
      exitReason: j.exit_reason,
    })),
    interactions: events.map((e) => ({
      type: e.type,
      at: iso(e.occurred_at),
      device: e.device,
      bot: e.is_bot,
    })),
  };
}

/** Suppression reasons that record a person's OBJECTION or an undeliverable address; honoring them is why they are kept. */
export const KEPT_SUPPRESSION_REASONS = [
  "unsubscribe",
  "hard_bounce",
  "complaint",
] as const;

/**
 * Right to erasure. Deletes the contact (cascading list/tag memberships and automation enrollments), anonymizes the
 * address on every send record (so campaign statistics stay correct but nobody can be identified), and deletes the
 * person's open/click events. The suppression entry survives only when it records an opt-out/bounce/complaint — that is
 * what stops us ever mailing the person again; manual/imported entries are removed.
 */
export async function eraseContact(
  db: Database,
  organizationId: OrganizationId,
  contactId: string,
) {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(
        and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)),
      )
      .limit(1);
    if (!c) return null;
    const org = sql`${organizationId}::uuid`;
    const recipients = await tx.execute<{ id: string }>(
      sql`select id from campaign_recipients where organization_id = ${org} and contact_id = ${c.id}::uuid`,
    );
    const ids = recipients.rows.map((r) => r.id);
    let events = 0;
    if (ids.length > 0) {
      const del = await tx.execute(
        sql`delete from tracking_events where organization_id = ${org} and recipient_id = any(${sql.raw(`array[${ids.map((i) => `'${i}'::uuid`).join(",")}]`)})`,
      );
      events = del.rowCount ?? 0;
      await tx.execute(sql`update campaign_recipients set email = 'erased-' || substr(id::text, 1, 8) || '@erased.invalid', last_error = null
                            where organization_id = ${org} and contact_id = ${c.id}::uuid`);
    }
    const supp = await tx.execute(
      sql`delete from suppressions where organization_id = ${org} and email = ${c.email} and reason not in ('unsubscribe','hard_bounce','complaint')`,
    );
    await tx
      .delete(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, c.id)));
    return {
      recipientsAnonymized: ids.length,
      eventsDeleted: events,
      suppressionsRemoved: supp.rowCount ?? 0,
    };
  });
}

// ---- workspace deletion --------------------------------------------------------------------------------------------

/**
 * Closes a workspace: hidden immediately (everything that looks organizations up already ignores `deleted_at`), all
 * sending stops, and the data is purged after the grace period. Reversible until then.
 */
export async function softDeleteOrganization(
  db: Database,
  organizationId: OrganizationId,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const done = await tx
      .update(organizations)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(organizations.id, organizationId),
          sql`${organizations.deletedAt} is null`,
        ),
      )
      .returning({ id: organizations.id });
    if (done.length === 0) return false;
    await tx.execute(
      sql`update campaigns set status = 'cancelled', updated_at = ${now} where organization_id = ${organizationId}::uuid and status in ('scheduled','pending_approval')`,
    );
    await tx.execute(
      sql`update campaigns set status = 'paused', halt_reason = 'org_deleted', updated_at = ${now} where organization_id = ${organizationId}::uuid and status = 'sending'`,
    );
    await tx.execute(
      sql`update automations set status = 'paused', updated_at = ${now} where organization_id = ${organizationId}::uuid and status = 'active'`,
    );
    return true;
  });
}

export async function restoreOrganization(
  db: Database,
  organizationId: OrganizationId,
  now: Date,
) {
  const grace = new Date(now.getTime() - RETENTION.orgGraceDays * 86_400_000);
  const rows = await db
    .update(organizations)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        eq(organizations.id, organizationId),
        sql`${organizations.deletedAt} >= ${grace}`,
      ),
    )
    .returning({ id: organizations.id });
  return rows.length > 0;
}

/** Cross-tenant maintenance: hard-deletes workspaces whose grace period is over (cascades remove all their data). */
export async function purgeDeletedOrganizations(db: Database, now: Date) {
  const cutoff = new Date(now.getTime() - RETENTION.orgGraceDays * 86_400_000);
  const rows = await db
    .delete(organizations)
    .where(sql`${organizations.deletedAt} < ${cutoff}`)
    .returning({ id: organizations.id });
  return rows.map((r) => r.id);
}

/** Cross-tenant retention sweep; every window is documented in RETENTION and in docs/MAILORY_DECISIONS.md. */
export async function runRetention(db: Database, now: Date) {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const n = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rowCount ?? 0;
  const result = {
    trackingEvents: await n(
      sql`delete from tracking_events where occurred_at < ${ago(RETENTION.trackingDays)} or (is_bot and occurred_at < ${ago(RETENTION.botTrackingDays)})`,
    ),
    providerEvents: await n(
      sql`delete from email_events where created_at < ${ago(RETENTION.providerEventDays)}`,
    ),
    aiRequests: await n(
      sql`delete from ai_requests where created_at < ${ago(RETENTION.aiRequestDays)}`,
    ),
    sessions: await n(
      sql`delete from sessions where expires_at < ${ago(RETENTION.authDebrisDays)} or (revoked_at is not null and revoked_at < ${ago(RETENTION.authDebrisDays)})`,
    ),
    userTokens: await n(
      sql`delete from user_tokens where expires_at < ${ago(RETENTION.authDebrisDays)}`,
    ),
    webhookDeliveries: await n(
      sql`delete from webhook_deliveries where created_at < ${ago(RETENTION.webhookDeliveryDays)}`,
    ),
    apiUsage: await n(
      sql`delete from api_usage where day < ${ago(RETENTION.apiUsageDays).toISOString().slice(0, 10)}::date`,
    ),
    outbox: await n(
      sql`delete from email_outbox where created_at < ${ago(RETENTION.outboxDays)}`,
    ),
    organizationsPurged: (await purgeDeletedOrganizations(db, now)).length,
  };
  return result;
}
