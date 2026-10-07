import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asOrganizationId, createDb, type Database } from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { toCsvLine } from "@mailory/core";
import type { Actor } from "../org/service";
import * as svc from "./service";

/** Opt-in (PERF=1): measures the "10.000+ contacts must not slow down" requirement on real Postgres. */
const suite = process.env.DATABASE_URL && process.env.PERF ? describe : describe.skip;
const N = Number(process.env.PERF_CONTACTS ?? 25_000);

suite(`audience performance @ ${N} contacts`, () => {
  let db: Database;
  let end: () => Promise<void>;
  let actor: Actor;
  const deps = () => ({ db });
  const timings: Record<string, number> = {};
  const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await fn();
    timings[label] = Math.round(performance.now() - start);
    return result;
  };

  beforeAll(async () => {
    const created = createDb(process.env.DATABASE_URL!);
    db = created.db;
    end = () => created.pool.end();
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    actor = {
      userId: user.id,
      organizationId: asOrganizationId(org.id),
      role: "owner",
    };
    await db.execute(sql`
      insert into contacts (organization_id, email, first_name, last_name, company, sector, city, status, created_at)
      select ${org.id}::uuid, 'perf-' || g || '@example.com', 'Ad' || g, 'Soyad' || (g % 500), 'Şirket ' || (g % 800),
        (array['Technology','Health','Finance','Education'])[1 + g % 4], (array['Ankara','İstanbul','İzmir','Bursa'])[1 + g % 4],
        case when g % 50 = 0 then 'bounced' else 'subscribed' end,
        now() - (g || ' seconds')::interval
      from generate_series(1, ${N}) g`);
    await db.execute(sql`analyze contacts`);
  }, 120_000);
  afterAll(async () => {
    console.log("PERF TIMINGS (ms):", JSON.stringify(timings));
    await end();
  });

  it("first page + total", async () => {
    const r = await time("first page+count", () =>
      svc.searchContacts(deps(), actor, { limit: 50 }),
    );
    expect(r.ok && r.total).toBe(N);
    expect(timings["first page+count"]).toBeLessThan(750);
  });
  it("deep keyset page costs the same as the first", async () => {
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const r = await svc.searchContacts(deps(), actor, { limit: 200, cursor });
      cursor = r.ok ? (r.nextCursor ?? undefined) : undefined;
    }
    await time("page 101 (no count)", () =>
      svc.searchContacts(deps(), actor, { limit: 50, cursor }),
    );
    expect(timings["page 101 (no count)"]).toBeLessThan(300);
  });
  it("substring search over name/email/company", async () => {
    await time("search 'soyad42'", () =>
      svc.searchContacts(deps(), actor, { filter: { q: "soyad42" }, limit: 50 }),
    );
    expect(timings["search 'soyad42'"]).toBeLessThan(1000);
  });
  it("status filter and a segment filter", async () => {
    await time("filter status=bounced", () =>
      svc.searchContacts(deps(), actor, { filter: { status: "bounced" }, limit: 50 }),
    );
    const def = {
      type: "group" as const,
      op: "and" as const,
      children: [
        { type: "rule" as const, field: "sector", op: "eq", value: "technology" },
        {
          type: "group" as const,
          op: "or" as const,
          children: [
            { type: "rule" as const, field: "city", op: "eq", value: "Ankara" },
            {
              type: "rule" as const,
              field: "company",
              op: "contains",
              value: "Şirket 7",
            },
          ],
        },
      ],
    };
    const r = await time("segment preview (count+sample)", () =>
      svc.previewSegment(deps(), actor, def),
    );
    expect(r.ok && r.count).toBeGreaterThan(0);
    expect(timings["segment preview (count+sample)"]).toBeLessThan(1500);
  });
  it("imports a 10k-row CSV", async () => {
    const rows = [
      "email,name,company",
      ...Array.from(
        { length: 10_000 },
        (_, i) =>
          `imp-${i}-${randomUUID().slice(0, 6)}@example.com,Ad${i},Firma ${i % 100}`,
      ),
    ];
    const r = await time("import 10k rows", () =>
      svc.runImport(deps(), actor, {
        csv: rows.join("\n"),
        mapping: { email: "email", name: "first_name", company: "company" },
        consentAttested: true,
        updateExisting: false,
      }),
    );
    expect(r).toMatchObject({ ok: true, inserted: 10_000 });
    expect(timings["import 10k rows"]).toBeLessThan(15_000);
  });
  it("re-imports the same 10k rows with updateExisting (upsert path)", async () => {
    const rows = [
      "email,name,company",
      ...Array.from(
        { length: 5000 },
        (_, i) => `perf-${i + 1}@example.com,Yeni${i},Y ${i}`,
      ),
    ];
    const r = await time("upsert 5k existing", () =>
      svc.runImport(deps(), actor, {
        csv: rows.join("\n"),
        mapping: { email: "email", name: "first_name", company: "company" },
        consentAttested: true,
        updateExisting: true,
      }),
    );
    expect(r).toMatchObject({ ok: true, updated: 5000, inserted: 0 });
  });
  it("streams a full export", async () => {
    const out = await svc.exportContacts(deps(), actor);
    if (!out.ok) throw new Error("export failed");
    let lines = 0;
    let bytes = 0;
    await time("export all", async () => {
      for await (const line of out.lines) {
        lines++;
        bytes += line.length;
      }
    });
    expect(lines).toBe(out.count + 1);
    expect(toCsvLine(["x"]).length).toBeGreaterThan(0);
    console.log(`export: ${lines} lines, ${(bytes / 1e6).toFixed(1)} MB`);
  });
});
