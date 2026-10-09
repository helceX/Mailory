import { randomBytes } from "node:crypto";
import {
  API_KEY_SCOPES,
  MAX_API_KEYS,
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_EVENTS,
  generateApiKey,
  webhookUrlProblem,
  type ApiKeyScope,
  type Permission,
} from "@mailory/core";
import {
  checkEntitlement,
  countActiveApiKeys,
  createApiKey,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  enqueueWebhookEvent,
  getWebhookEndpoint,
  listApiKeys,
  listRecentDeliveries,
  listWebhookEndpoints,
  recordAudit,
  revokeApiKey,
  updateWebhookEndpoint,
  type Database,
} from "@mailory/db";
import { authorize, type Actor } from "../org/service";

export type DevDeps = {
  db: Database;
  now?: () => Date;
  allowInsecureWebhooks?: boolean;
};
type Code = "forbidden" | "not_found" | "invalid" | "limit_reached";
export type Failure = { ok: false; code: Code; message?: string };
const fail = (code: Code, message?: string): Failure => ({ ok: false, code, message });
const need = (a: Actor, p: Permission) => authorize(a, p);
const clock = (d: DevDeps) => (d.now ?? (() => new Date()))();
const PERM: Permission = "api_keys:manage";

function audit(
  deps: DevDeps,
  actor: Actor,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType: action.startsWith("api_key") ? "api_key" : "webhook_endpoint",
    entityId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}

export async function developerOverviewFor(deps: DevDeps, actor: Actor) {
  if (!need(actor, PERM)) return fail("forbidden");
  const [keys, endpoints, quota] = await Promise.all([
    listApiKeys(deps.db, actor.organizationId),
    listWebhookEndpoints(deps.db, actor.organizationId),
    checkEntitlement(deps.db, actor.organizationId, "api_requests", 0, clock(deps)),
  ]);
  return { ok: true as const, keys, endpoints, quota };
}

export async function createApiKeyFor(
  deps: DevDeps,
  actor: Actor,
  input: { name: string; scope: ApiKeyScope },
) {
  if (!need(actor, PERM)) return fail("forbidden");
  const name = input.name.trim();
  if (!name || name.length > 80)
    return fail("invalid", "Anahtar adı 1–80 karakter olmalı.");
  if (!API_KEY_SCOPES.includes(input.scope)) return fail("invalid");
  if ((await countActiveApiKeys(deps.db, actor.organizationId)) >= MAX_API_KEYS)
    return fail("limit_reached", `En fazla ${MAX_API_KEYS} etkin anahtar olabilir.`);
  const generated = generateApiKey();
  const row = await createApiKey(deps.db, actor.organizationId, {
    name,
    scope: input.scope,
    prefix: generated.prefix,
    secretHash: generated.hash,
    userId: actor.userId,
  });
  await audit(deps, actor, "api_key.created", row.id, { scope: input.scope });
  // The full key is returned exactly once; only its hash is stored.
  return {
    ok: true as const,
    id: row.id,
    key: generated.key,
    prefix: generated.prefix,
  };
}

export async function revokeApiKeyFor(deps: DevDeps, actor: Actor, id: string) {
  if (!need(actor, PERM)) return fail("forbidden");
  const done = await revokeApiKey(deps.db, actor.organizationId, id, clock(deps));
  if (!done) return fail("not_found");
  await audit(deps, actor, "api_key.revoked", id);
  return { ok: true as const };
}

function checkEvents(events: string[]) {
  const unique = [...new Set(events)];
  if (unique.length === 0) return "En az bir olay seçin.";
  if (unique.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e)))
    return "Bilinmeyen olay türü.";
  return null;
}

export async function createWebhookFor(
  deps: DevDeps,
  actor: Actor,
  input: { url: string; events: string[] },
) {
  if (!need(actor, PERM)) return fail("forbidden");
  const problem =
    webhookUrlProblem(input.url, { allowInsecure: deps.allowInsecureWebhooks }) ??
    checkEvents(input.events);
  if (problem) return fail("invalid", problem);
  const existing = await listWebhookEndpoints(deps.db, actor.organizationId);
  if (existing.length >= MAX_WEBHOOK_ENDPOINTS)
    return fail("limit_reached", `En fazla ${MAX_WEBHOOK_ENDPOINTS} webhook olabilir.`);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const row = await createWebhookEndpoint(deps.db, actor.organizationId, {
    url: input.url,
    secret,
    events: [...new Set(input.events)],
    userId: actor.userId,
  });
  await audit(deps, actor, "webhook.created", row.id, { url: input.url });
  return { ok: true as const, id: row.id, secret };
}

export async function updateWebhookFor(
  deps: DevDeps,
  actor: Actor,
  id: string,
  patch: { url?: string; events?: string[]; enabled?: boolean },
) {
  if (!need(actor, PERM)) return fail("forbidden");
  const problem =
    (patch.url !== undefined
      ? webhookUrlProblem(patch.url, { allowInsecure: deps.allowInsecureWebhooks })
      : null) ?? (patch.events !== undefined ? checkEvents(patch.events) : null);
  if (problem) return fail("invalid", problem);
  const row = await updateWebhookEndpoint(deps.db, actor.organizationId, id, patch);
  if (!row) return fail("not_found");
  await audit(deps, actor, "webhook.updated", id, { fields: Object.keys(patch) });
  return { ok: true as const };
}

export async function deleteWebhookFor(deps: DevDeps, actor: Actor, id: string) {
  if (!need(actor, PERM)) return fail("forbidden");
  if (!(await deleteWebhookEndpoint(deps.db, actor.organizationId, id)))
    return fail("not_found");
  await audit(deps, actor, "webhook.deleted", id);
  return { ok: true as const };
}

/** Queues a harmless `ping` event to one endpoint so the owner can see the round trip work. */
export async function testWebhookFor(deps: DevDeps, actor: Actor, id: string) {
  if (!need(actor, PERM)) return fail("forbidden");
  const endpoint = await getWebhookEndpoint(deps.db, actor.organizationId, id);
  if (!endpoint) return fail("not_found");
  if (!endpoint.enabled) return fail("invalid", "Webhook kapalı; önce etkinleştirin.");
  await enqueueWebhookEvent(
    deps.db,
    actor.organizationId,
    "ping",
    { message: "Mailory test olayı" },
    clock(deps),
    { endpointId: id },
  );
  return { ok: true as const };
}

export async function webhookDeliveriesFor(deps: DevDeps, actor: Actor, id: string) {
  if (!need(actor, PERM)) return fail("forbidden");
  if (!(await getWebhookEndpoint(deps.db, actor.organizationId, id)))
    return fail("not_found");
  return {
    ok: true as const,
    deliveries: await listRecentDeliveries(deps.db, actor.organizationId, id),
  };
}
