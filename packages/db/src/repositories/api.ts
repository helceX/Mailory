import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  DISABLE_AFTER_FAILURES,
  MAX_DELIVERY_ATTEMPTS,
  webhookBackoffSeconds,
} from "@mailory/core/shared";
import type { Database, OrganizationId } from "../index";
import {
  apiKeys,
  organizations,
  webhookDeliveries,
  webhookEndpoints,
} from "../schema/index";

// ---- API keys ------------------------------------------------------------------------------------------------------

export async function createApiKey(
  db: Database,
  organizationId: OrganizationId,
  input: {
    name: string;
    scope: "read" | "write";
    prefix: string;
    secretHash: string;
    userId: string | null;
  },
) {
  const [row] = await db
    .insert(apiKeys)
    .values({
      organizationId,
      name: input.name,
      scope: input.scope,
      prefix: input.prefix,
      secretHash: input.secretHash,
      createdByUserId: input.userId,
    })
    .returning();
  return row!;
}

export async function listApiKeys(db: Database, organizationId: OrganizationId) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, organizationId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function countActiveApiKeys(db: Database, organizationId: OrganizationId) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.organizationId, organizationId), isNull(apiKeys.revokedAt)));
  return r?.n ?? 0;
}

export async function revokeApiKey(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  now: Date,
) {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiKeys.organizationId, organizationId),
        eq(apiKeys.id, id),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/**
 * Authentication lookup: the prefix identifies the key (and therefore the organization); the caller then compares the
 * secret hash in constant time. Deleted organizations resolve to nothing, suspended ones are reported to the caller.
 */
export async function findApiKeyByPrefix(db: Database, prefix: string) {
  const [row] = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      secretHash: apiKeys.secretHash,
      scope: apiKeys.scope,
      createdByUserId: apiKeys.createdByUserId,
      revokedAt: apiKeys.revokedAt,
      suspendedAt: organizations.suspendedAt,
    })
    .from(apiKeys)
    .innerJoin(organizations, eq(organizations.id, apiKeys.organizationId))
    .where(and(eq(apiKeys.prefix, prefix), isNull(organizations.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function touchApiKey(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  now: Date,
) {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(and(eq(apiKeys.organizationId, organizationId), eq(apiKeys.id, id)));
}

// ---- metering ------------------------------------------------------------------------------------------------------

export async function bumpApiUsage(
  db: Database,
  organizationId: OrganizationId,
  now: Date,
) {
  const day = now.toISOString().slice(0, 10);
  await db.execute(sql`
    insert into api_usage (organization_id, day, count) values (${organizationId}::uuid, ${day}::date, 1)
    on conflict (organization_id, day) do update set count = api_usage.count + 1`);
}

export async function apiUsageSince(
  db: Database,
  organizationId: OrganizationId,
  since: Date,
) {
  const r = await db.execute<{ n: string }>(
    sql`select coalesce(sum(count), 0) as n from api_usage where organization_id = ${organizationId}::uuid and day >= ${since.toISOString().slice(0, 10)}::date`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

// ---- webhook endpoints ---------------------------------------------------------------------------------------------

export async function createWebhookEndpoint(
  db: Database,
  organizationId: OrganizationId,
  input: { url: string; secret: string; events: string[]; userId: string | null },
) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      organizationId,
      url: input.url,
      secret: input.secret,
      events: input.events,
      createdByUserId: input.userId,
    })
    .returning();
  return row!;
}

export async function listWebhookEndpoints(
  db: Database,
  organizationId: OrganizationId,
) {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, organizationId))
    .orderBy(desc(webhookEndpoints.createdAt));
  // The signing secret is shown once, at creation.
  return rows.map(({ secret: _secret, ...rest }) => rest);
}

export async function getWebhookEndpoint(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateWebhookEndpoint(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  patch: { url?: string; events?: string[]; enabled?: boolean },
) {
  const set: Partial<typeof webhookEndpoints.$inferInsert> = {};
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.events !== undefined) set.events = patch.events;
  if (patch.enabled !== undefined) {
    set.enabled = patch.enabled;
    if (patch.enabled) {
      set.consecutiveFailures = 0;
      set.disabledReason = null;
    }
  }
  if (Object.keys(set).length === 0) return getWebhookEndpoint(db, organizationId, id);
  const [row] = await db
    .update(webhookEndpoints)
    .set(set)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.id, id),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteWebhookEndpoint(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.id, id),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  return rows.length > 0;
}

export async function listRecentDeliveries(
  db: Database,
  organizationId: OrganizationId,
  endpointId: string,
  limit = 20,
) {
  return db
    .select({
      id: webhookDeliveries.id,
      eventType: webhookDeliveries.eventType,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.organizationId, organizationId),
        eq(webhookDeliveries.endpointId, endpointId),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(limit, 100));
}

// ---- webhook deliveries --------------------------------------------------------------------------------------------

export type WebhookEnvelope = {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
};

/** Queues one delivery per enabled endpoint of the organization that subscribes to the event. Returns how many. */
export async function enqueueWebhookEvent(
  db: Database,
  organizationId: OrganizationId,
  type: string,
  data: Record<string, unknown>,
  now: Date,
  options: { endpointId?: string } = {},
) {
  const envelope: WebhookEnvelope = {
    id: randomUUID(),
    type,
    createdAt: now.toISOString(),
    data,
  };
  // A targeted send (the "test" ping) goes to that one endpoint whatever it subscribes to.
  const match = options.endpointId
    ? sql`e.id = ${options.endpointId}::uuid`
    : sql`${type} = any(e.events)`;
  const r = await db.execute(sql`
    insert into webhook_deliveries (organization_id, endpoint_id, event_type, payload, next_attempt_at)
    select e.organization_id, e.id, ${type}, ${JSON.stringify(envelope)}::jsonb, ${now}
      from webhook_endpoints e
     where e.organization_id = ${organizationId}::uuid and e.enabled and ${match}`);
  return r.rowCount ?? 0;
}

const LEASE_MS = 2 * 60_000;

/** Worker: leases due deliveries (SKIP LOCKED) together with their endpoint. Cross-tenant by design. */
export async function claimWebhookDeliveries(
  db: Database,
  limit: number,
  now: Date,
  scope: { organizationId?: string } = {},
) {
  const lease = new Date(now.getTime() + LEASE_MS);
  const org = scope.organizationId
    ? sql`and organization_id = ${scope.organizationId}::uuid`
    : sql``;
  const r = await db.execute<{
    id: string;
    organization_id: string;
    endpoint_id: string;
    event_type: string;
    payload: WebhookEnvelope;
    attempts: number;
    url: string;
    secret: string;
    enabled: boolean;
  }>(sql`
    with due as (
      select id from webhook_deliveries
       where status = 'pending' and next_attempt_at <= ${now}
         and (locked_until is null or locked_until < ${now}) ${org}
         and exists (select 1 from webhook_endpoints e where e.id = endpoint_id and e.enabled)
       order by next_attempt_at
       limit ${limit}
       for update skip locked)
    update webhook_deliveries d
       set locked_until = ${lease}, attempts = d.attempts + 1
      from due, webhook_endpoints e
     where d.id = due.id and e.id = d.endpoint_id
    returning d.id, d.organization_id, d.endpoint_id, d.event_type, d.payload, d.attempts, e.url, e.secret, e.enabled`);
  return r.rows;
}

/** Records the outcome of one attempt: delivered, scheduled for retry with backoff, or given up. */
export async function completeWebhookDelivery(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  outcome: { ok: boolean; statusCode: number | null; error: string | null },
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.organizationId, organizationId),
          eq(webhookDeliveries.id, id),
        ),
      )
      .for("update")
      .limit(1);
    if (!d) return null;
    const retryIn = outcome.ok ? null : webhookBackoffSeconds(d.attempts);
    const giveUp =
      !outcome.ok && (retryIn === null || d.attempts >= MAX_DELIVERY_ATTEMPTS);
    await tx
      .update(webhookDeliveries)
      .set({
        status: outcome.ok ? "delivered" : giveUp ? "failed" : "pending",
        lockedUntil: null,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error?.slice(0, 300) ?? null,
        deliveredAt: outcome.ok ? now : null,
        nextAttemptAt: retryIn
          ? new Date(now.getTime() + retryIn * 1000)
          : d.nextAttemptAt,
      })
      .where(eq(webhookDeliveries.id, id));
    if (outcome.ok) {
      await tx
        .update(webhookEndpoints)
        .set({ consecutiveFailures: 0 })
        .where(eq(webhookEndpoints.id, d.endpointId));
    } else if (giveUp) {
      // Only exhausted deliveries count against the endpoint, so a brief outage does not switch it off.
      await tx.execute(sql`
        update webhook_endpoints
           set consecutive_failures = consecutive_failures + 1,
               enabled = case when consecutive_failures + 1 >= ${DISABLE_AFTER_FAILURES} then false else enabled end,
               disabled_reason = case when consecutive_failures + 1 >= ${DISABLE_AFTER_FAILURES} then 'Art arda başarısız teslimatlar nedeniyle kapatıldı' else disabled_reason end
         where id = ${d.endpointId}::uuid`);
    }
    return { status: outcome.ok ? "delivered" : giveUp ? "failed" : "pending" };
  });
}

/**
 * Emits an email event for one recipient to the organization's subscribed endpoints. The common case (no endpoint
 * subscribes) costs one indexed existence check; only then is the recipient loaded. Never throws into the caller's
 * main flow — a webhook problem must not break sending, tracking or unsubscribing.
 */
export async function emitRecipientWebhook(
  db: Database,
  organizationId: OrganizationId,
  type: string,
  recipientId: string,
  extra: Record<string, unknown>,
  now: Date,
) {
  try {
    const org = sql`${organizationId}::uuid`;
    const has = await db.execute(
      sql`select 1 from webhook_endpoints where organization_id = ${org} and enabled and ${type} = any(events) limit 1`,
    );
    if (has.rows.length === 0) return 0;
    const r = await db.execute<{
      email: string;
      contact_id: string | null;
      campaign_id: string;
    }>(
      sql`select email, contact_id, campaign_id from campaign_recipients where organization_id = ${org} and id = ${recipientId}::uuid`,
    );
    const row = r.rows[0];
    if (!row) return 0;
    return await enqueueWebhookEvent(
      db,
      organizationId,
      type,
      {
        campaignId: row.campaign_id,
        contactId: row.contact_id,
        recipientId,
        email: row.email,
        ...extra,
      },
      now,
    );
  } catch (error) {
    console.error("[webhooks] emit failed", error);
    return 0;
  }
}
