import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  asOrganizationId,
  auditLogs,
  contacts,
  createDb,
  getUsage,
  setOverride,
  suppressions,
  type Database,
} from "@mailory/db";
import { addTestMember, createTestOrg, createTestUser } from "@mailory/db/testing";
import type { OrgRole } from "@mailory/core";
import { updateContactFor } from "../audience/service";
import type { Actor } from "../org/service";
import { cleanupDormantFor, getCleanupFor, restoreCleanedFor } from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("list cleanup and reachable-contact billing (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const deps = () => ({ db });

  async function tenant(role: OrgRole = "owner") {
    const owner = await createTestUser(db);
    const org = await createTestOrg(db, owner.id);
    let userId = owner.id;
    if (role !== "owner") {
      const u = await createTestUser(db);
      await addTestMember(db, org.id, u.id, role);
      userId = u.id;
    }
    const actor: Actor = { userId, organizationId: asOrganizationId(org.id), role };
    return { org, oid: asOrganizationId(org.id), actor };
  }
  const mk = async (
    t: Awaited<ReturnType<typeof tenant>>,
    over: {
      status?: string;
      score?: number | null;
      ageDays?: number;
      email?: string;
    } = {},
  ) => {
    const email = over.email ?? `c-${randomUUID().slice(0, 8)}@example.org`;
    const [c] = await db
      .insert(contacts)
      .values({
        organizationId: t.org.id,
        email,
        status: over.status ?? "subscribed",
        engagementScore: over.score === undefined ? null : over.score,
        createdAt: new Date(Date.now() - (over.ageDays ?? 120) * 86_400_000),
      })
      .returning();
    return c!;
  };
  const status = async (id: string) =>
    (await db.select().from(contacts).where(eq(contacts.id, id)))[0]!.status;

  it("only subscribed, old contacts with a zero engagement score are candidates", async () => {
    const t = await tenant();
    const dormant = await mk(t, { score: 0 });
    await mk(t, { score: 0, ageDays: 10 }); // too new
    await mk(t, { score: 12 }); // reacts a bit
    await mk(t, { score: null }); // not enough sends to judge
    await mk(t, { score: 0, status: "unsubscribed" });
    expect(await getCleanupFor(deps(), t.actor)).toMatchObject({
      ok: true,
      candidates: 1,
      cleaned: 0,
    });
    const r = await cleanupDormantFor(deps(), t.actor);
    expect(r).toMatchObject({ ok: true, cleaned: 1 });
    expect(await status(dormant.id)).toBe("cleaned");
    expect(await getCleanupFor(deps(), t.actor)).toMatchObject({
      candidates: 0,
      cleaned: 1,
    });
  });

  it("is audited with the count, and limited to people who may write contacts", async () => {
    const t = await tenant();
    await mk(t, { score: 0 });
    const viewer = await tenant("viewer");
    expect(await cleanupDormantFor(deps(), viewer.actor)).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await restoreCleanedFor(deps(), viewer.actor)).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect((await getCleanupFor(deps(), viewer.actor)).ok).toBe(true); // viewing is allowed
    await cleanupDormantFor(deps(), t.actor);
    const row = (
      await db.select().from(auditLogs).where(eq(auditLogs.organizationId, t.org.id))
    ).find((a) => a.action === "contacts.cleaned");
    expect(row?.metadata).toMatchObject({ count: 1 });
  });

  it("never touches another workspace", async () => {
    const a = await tenant();
    const b = await tenant();
    const bDormant = await mk(b, { score: 0 });
    await mk(a, { score: 0 });
    await cleanupDormantFor(deps(), a.actor);
    expect(await status(bDormant.id)).toBe("subscribed");
  });

  it("cleaned contacts do not count toward the plan's contact limit (reachable people only)", async () => {
    const t = await tenant();
    await mk(t, { score: 0 });
    await mk(t, { score: 0 });
    await mk(t, { score: 50 });
    await mk(t, { status: "unsubscribed" });
    expect(await getUsage(db, t.oid, "contacts")).toBe(3);
    await cleanupDormantFor(deps(), t.actor);
    expect(await getUsage(db, t.oid, "contacts")).toBe(1);
  });

  it("restoring brings people back oldest-first, resets their score, respects the plan limit and suppressions", async () => {
    const t = await tenant();
    const a = await mk(t, { score: 0, ageDays: 300 });
    const b = await mk(t, { score: 0, ageDays: 200 });
    const c = await mk(t, { score: 0, ageDays: 100 });
    await cleanupDormantFor(deps(), t.actor);
    await db
      .insert(suppressions)
      .values({ organizationId: t.org.id, email: c.email, reason: "manual" });
    await setOverride(db, t.oid, {
      key: "contacts",
      limit: 1,
      reason: "t",
      userId: null,
      byOrganizationId: null,
    });
    const r = await restoreCleanedFor(deps(), t.actor);
    expect(r).toMatchObject({ ok: true, restored: 1, limited: true });
    expect(await status(a.id)).toBe("subscribed");
    expect(await status(b.id)).toBe("cleaned");
    expect(await status(c.id)).toBe("cleaned"); // suppressed: never restored
    const [restored] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    expect(restored!.engagementScore).toBeNull();
    // With room, the next one comes back too (but never the suppressed one).
    await setOverride(db, t.oid, {
      key: "contacts",
      limit: null,
      reason: "t",
      userId: null,
      byOrganizationId: null,
    });
    expect(await restoreCleanedFor(deps(), t.actor)).toMatchObject({ restored: 1 });
    expect(await status(c.id)).toBe("cleaned");
  });

  it("re-subscribing a cleaned contact through the contact editor also needs a free slot", async () => {
    const t = await tenant();
    const c = await mk(t, { score: 0 });
    await cleanupDormantFor(deps(), t.actor);
    await mk(t, { score: 50 });
    await setOverride(db, t.oid, {
      key: "contacts",
      limit: 1,
      reason: "t",
      userId: null,
      byOrganizationId: null,
    });
    const blocked = await updateContactFor(deps(), t.actor, c.id, {
      status: "subscribed",
    });
    expect(blocked).toMatchObject({ ok: false, code: "plan_limit" });
    await setOverride(db, t.oid, {
      key: "contacts",
      limit: 5,
      reason: "t",
      userId: null,
      byOrganizationId: null,
    });
    expect(
      (await updateContactFor(deps(), t.actor, c.id, { status: "subscribed" })).ok,
    ).toBe(true);
    void sql;
  });
});
