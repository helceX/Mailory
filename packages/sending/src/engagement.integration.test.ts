import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  campaignRecipients,
  campaigns,
  contacts,
  createContact,
  createDb,
  refreshEngagement,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_UTM, engagementScore } from "@mailory/core";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("engagement refresh (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const NOW = new Date("2026-06-01T00:00:00Z");
  const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  async function contactWith(
    orgId: string,
    camps: string[],
    pattern: { opened: number; clicked: number },
    daysAgo = 5,
  ) {
    const c = (await createContact(db, asOrganizationId(orgId), {
      email: `e-${randomUUID().slice(0, 8)}@example.org`,
    }))!;
    await db.insert(campaignRecipients).values(
      camps.map((campaignId, i) => ({
        organizationId: orgId,
        campaignId,
        contactId: c.id,
        email: c.email,
        status: "delivered",
        sentAt: day(daysAgo + i),
        openedAt: i < pattern.opened ? day(daysAgo + i - 0.1) : null,
        clickedAt: i < pattern.clicked ? day(daysAgo + i - 0.2) : null,
      })),
    );
    return c;
  }
  const score = async (id: string) =>
    (await db.select().from(contacts).where(eq(contacts.id, id)))[0]!;

  it("matches the pure formula, leaves thin data unscored, and ages quiet contacts out", async () => {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const other = await createTestOrg(db, (await createTestUser(db)).id);
    const camps = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        db
          .insert(campaigns)
          .values({ organizationId: org.id, name: `c${i}`, utm: DEFAULT_UTM })
          .returning()
          .then((r) => r[0]!.id),
      ),
    );
    const engaged = await contactWith(org.id, camps, { opened: 6, clicked: 3 });
    const lukewarm = await contactWith(org.id, camps, { opened: 2, clicked: 0 });
    const silent = await contactWith(org.id, camps, { opened: 0, clicked: 0 });
    const thin = await contactWith(org.id, camps.slice(0, 2), {
      opened: 2,
      clicked: 2,
    });
    const old = await contactWith(org.id, camps, { opened: 6, clicked: 6 }, 200); // outside the 90-day window
    await db
      .update(contacts)
      .set({ engagementScore: 77 })
      .where(eq(contacts.id, old.id));
    const foreign = await contactWith(
      other.id,
      [
        (
          await db
            .insert(campaigns)
            .values({ organizationId: other.id, name: "f", utm: DEFAULT_UTM })
            .returning()
        )[0]!.id,
      ],
      { opened: 1, clicked: 1 },
    );

    await refreshEngagement(db, NOW, { organizationId: org.id });

    expect((await score(engaged.id)).engagementScore).toBe(
      engagementScore({ sent: 6, opened: 6, clicked: 3 }),
    );
    expect((await score(lukewarm.id)).engagementScore).toBe(
      engagementScore({ sent: 6, opened: 2, clicked: 0 }),
    );
    expect((await score(silent.id)).engagementScore).toBe(0);
    expect((await score(thin.id)).engagementScore).toBeNull();
    expect((await score(old.id)).engagementScore).toBeNull(); // aged out
    expect((await score(engaged.id)).lastActivityAt).not.toBeNull();
    // Scoped refresh never touches another tenant.
    expect((await score(foreign.id)).engagementScore).toBeNull();
  });
});
