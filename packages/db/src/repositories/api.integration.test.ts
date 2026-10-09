import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { generateApiKey, parseApiKey, apiHashesEqual } from "@mailory/core";
import {
  apiUsageSince,
  asOrganizationId,
  bumpApiUsage,
  checkEntitlement,
  claimWebhookDeliveries,
  completeWebhookDelivery,
  createApiKey,
  createDb,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  enqueueWebhookEvent,
  findApiKeyByPrefix,
  getWebhookEndpoint,
  listApiKeys,
  listRecentDeliveries,
  listWebhookEndpoints,
  organizations,
  revokeApiKey,
  setOverride,
  updateWebhookEndpoint,
  webhookDeliveries,
  webhookEndpoints,
  type Database,
} from "../index";
import { createTestOrg, createTestUser } from "../testing";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const DAY = 86_400_000;

suite("public API + webhooks repository (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  async function org() {
    const user = await createTestUser(db);
    const o = await createTestOrg(db, user.id);
    return { user, id: asOrganizationId(o.id) };
  }

  it("authenticates by prefix + secret hash, hides revoked keys and deleted organizations", async () => {
    const a = await org();
    const k = generateApiKey();
    const row = await createApiKey(db, a.id, {
      name: "n",
      scope: "write",
      prefix: k.prefix,
      secretHash: k.hash,
      userId: a.user.id,
    });
    const parsed = parseApiKey(k.key)!;
    const found = await findApiKeyByPrefix(db, parsed.prefix);
    expect(found?.organizationId).toBe(a.id);
    expect(apiHashesEqual(found!.secretHash, parsed.hash)).toBe(true);
    // The listing never exposes the hash.
    expect(JSON.stringify(await listApiKeys(db, a.id))).not.toContain(k.hash);

    const now = new Date();
    expect(await revokeApiKey(db, a.id, row.id, now)).toBe(true);
    expect((await findApiKeyByPrefix(db, parsed.prefix))?.revokedAt).not.toBeNull();
    expect(await revokeApiKey(db, a.id, row.id, now)).toBe(false);

    await db
      .update(organizations)
      .set({ deletedAt: now })
      .where(eq(organizations.id, a.id));
    expect(await findApiKeyByPrefix(db, parsed.prefix)).toBeNull();
  });

  it("another tenant cannot revoke or see a key", async () => {
    const a = await org();
    const b = await org();
    const k = generateApiKey();
    const row = await createApiKey(db, a.id, {
      name: "n",
      scope: "read",
      prefix: k.prefix,
      secretHash: k.hash,
      userId: a.user.id,
    });
    expect(await revokeApiKey(db, b.id, row.id, new Date())).toBe(false);
    expect(await listApiKeys(db, b.id)).toHaveLength(0);
  });

  it("meters requests per day and enforces the api_requests plan limit", async () => {
    const a = await org();
    const now = new Date("2026-05-15T10:00:00Z");
    for (let i = 0; i < 3; i++) await bumpApiUsage(db, a.id, now);
    await bumpApiUsage(db, a.id, new Date(now.getTime() - 40 * DAY)); // previous month
    expect(await apiUsageSince(db, a.id, new Date("2026-05-01T00:00:00Z"))).toBe(3);
    await setOverride(db, a.id, {
      key: "api_requests",
      limit: 3,
      reason: "test",
      userId: a.user.id,
      byOrganizationId: null,
    });
    const c = await checkEntitlement(db, a.id, "api_requests", 1, now);
    expect(c).toMatchObject({ allowed: false, used: 3, limit: 3 });
    await setOverride(db, a.id, {
      key: "api_requests",
      limit: 4,
      reason: "test",
      userId: a.user.id,
      byOrganizationId: null,
    });
    expect((await checkEntitlement(db, a.id, "api_requests", 1, now)).allowed).toBe(
      true,
    );
  });

  it("webhook events go only to enabled endpoints of the same organization that subscribe", async () => {
    const a = await org();
    const b = await org();
    const mk = (o: typeof a, events: string[]) =>
      createWebhookEndpoint(db, o.id, {
        url: "https://x.example/h",
        secret: "s",
        events,
        userId: o.user.id,
      });
    const yes = await mk(a, ["email.bounced"]);
    const other = await mk(a, ["email.opened"]);
    const off = await mk(a, ["email.bounced"]);
    await updateWebhookEndpoint(db, a.id, off.id, { enabled: false });
    const foreign = await mk(b, ["email.bounced"]);
    const n = await enqueueWebhookEvent(
      db,
      a.id,
      "email.bounced",
      { email: "x@y.z" },
      new Date(),
    );
    expect(n).toBe(1);
    expect(await listRecentDeliveries(db, a.id, yes.id)).toHaveLength(1);
    expect(await listRecentDeliveries(db, a.id, other.id)).toHaveLength(0);
    expect(await listRecentDeliveries(db, a.id, off.id)).toHaveLength(0);
    expect(await listRecentDeliveries(db, b.id, foreign.id)).toHaveLength(0);
    // The secret is never returned by listings.
    expect(JSON.stringify(await listWebhookEndpoints(db, a.id))).not.toContain(
      '"secret"',
    );
    // A cross-tenant endpoint id is invisible.
    expect(await getWebhookEndpoint(db, b.id, yes.id)).toBeNull();
    expect(await deleteWebhookEndpoint(db, b.id, yes.id)).toBe(false);
  });

  it("the database refuses a delivery that points at another organization's endpoint", async () => {
    const a = await org();
    const b = await org();
    const ep = await createWebhookEndpoint(db, a.id, {
      url: "https://x.example/h",
      secret: "s",
      events: ["email.opened"],
      userId: a.user.id,
    });
    await expect(
      db.insert(webhookDeliveries).values({
        organizationId: b.id,
        endpointId: ep.id,
        eventType: "email.opened",
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it("claims due deliveries once, retries with backoff, gives up, and switches a failing endpoint off", async () => {
    const a = await org();
    const t0 = new Date("2026-06-01T10:00:00Z");
    const ep = await createWebhookEndpoint(db, a.id, {
      url: "https://x.example/h",
      secret: "s",
      events: ["email.opened"],
      userId: a.user.id,
    });
    await enqueueWebhookEvent(db, a.id, "email.opened", {}, t0);
    const scope = { organizationId: a.id };

    const first = await claimWebhookDeliveries(db, 10, t0, scope);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      url: "https://x.example/h",
      secret: "s",
      attempts: 1,
    });
    // Leased: a second worker gets nothing.
    expect(await claimWebhookDeliveries(db, 10, t0, scope)).toHaveLength(0);

    await completeWebhookDelivery(
      db,
      a.id,
      first[0]!.id,
      { ok: false, statusCode: 500, error: "HTTP 500" },
      t0,
    );
    const [afterFail] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, first[0]!.id));
    expect(afterFail).toMatchObject({
      status: "pending",
      attempts: 1,
      lastStatusCode: 500,
    });
    expect(afterFail!.nextAttemptAt.getTime() - t0.getTime()).toBe(30_000);
    // Not due yet, due after the backoff.
    expect(
      await claimWebhookDeliveries(db, 10, new Date(t0.getTime() + 10_000), scope),
    ).toHaveLength(0);
    let now = new Date(t0.getTime() + 31_000);
    for (let attempt = 2; attempt <= 8; attempt++) {
      const c = await claimWebhookDeliveries(db, 10, now, scope);
      expect(c, `attempt ${attempt}`).toHaveLength(1);
      expect(c[0]!.attempts).toBe(attempt);
      await completeWebhookDelivery(
        db,
        a.id,
        c[0]!.id,
        { ok: false, statusCode: null, error: "boom" },
        now,
      );
      now = new Date(now.getTime() + 13 * 3600_000);
    }
    const [dead] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, first[0]!.id));
    expect(dead!.status).toBe("failed");
    expect(
      await claimWebhookDeliveries(db, 10, new Date(now.getTime() + DAY), scope),
    ).toHaveLength(0);
    const [e1] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));
    expect(e1!.consecutiveFailures).toBe(1);

    // 19 more exhausted deliveries switch the endpoint off.
    await db.execute(
      sql`update webhook_endpoints set consecutive_failures = 19 where id = ${ep.id}::uuid`,
    );
    await enqueueWebhookEvent(db, a.id, "email.opened", {}, now);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const c = await claimWebhookDeliveries(db, 10, now, scope);
      if (c.length === 0) break;
      await completeWebhookDelivery(
        db,
        a.id,
        c[0]!.id,
        { ok: false, statusCode: 500, error: "x" },
        now,
      );
      now = new Date(now.getTime() + 13 * 3600_000);
    }
    const [e2] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));
    expect(e2).toMatchObject({ enabled: false });
    expect(e2!.disabledReason).toBeTruthy();
    // Re-enabling resets the failure count.
    await updateWebhookEndpoint(db, a.id, ep.id, { enabled: true });
    const [e3] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));
    expect(e3).toMatchObject({
      enabled: true,
      consecutiveFailures: 0,
      disabledReason: null,
    });
  });

  it("a success clears the failure streak; disabled endpoints are not claimed", async () => {
    const a = await org();
    const t0 = new Date();
    const ep = await createWebhookEndpoint(db, a.id, {
      url: "https://x.example/h",
      secret: "s",
      events: ["ping"],
      userId: a.user.id,
    });
    await db.execute(
      sql`update webhook_endpoints set consecutive_failures = 5 where id = ${ep.id}::uuid`,
    );
    await enqueueWebhookEvent(db, a.id, "ping", {}, t0, { endpointId: ep.id });
    const [c] = await claimWebhookDeliveries(db, 5, t0, { organizationId: a.id });
    await completeWebhookDelivery(
      db,
      a.id,
      c!.id,
      { ok: true, statusCode: 204, error: null },
      t0,
    );
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, ep.id));
    expect(row!.consecutiveFailures).toBe(0);

    await enqueueWebhookEvent(db, a.id, "ping", {}, t0, { endpointId: ep.id });
    await updateWebhookEndpoint(db, a.id, ep.id, { enabled: false });
    expect(
      await claimWebhookDeliveries(db, 5, t0, { organizationId: a.id }),
    ).toHaveLength(0);
    void randomUUID;
  });
});
