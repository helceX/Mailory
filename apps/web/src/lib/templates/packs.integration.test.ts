import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import {
  asOrganizationId,
  assets,
  createDb,
  templates,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { docHasUnsubscribe } from "@mailory/core";
import { buildMergeValues, renderEmail } from "@mailory/email";
import type { Actor } from "../org/service";
import { EXPECTED_WARNING, importPacks, readManifest } from "./packs";
import { getTemplateFor } from "./service";

vi.setConfig({ testTimeout: 60_000 });
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const PACKS = resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../templates/packs",
);
// Three categories: recruitment, ecommerce, event.
const THREE = [
  "akasya-insan-kaynaklari-kariyer-bulteni",
  "akcaagac-dekorasyon-magaza-bulteni",
  "aksam-muzik-ve-sinema-daveti",
];

suite("template pack import (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const deps = () => ({ db, appUrl: "https://app.test" });
  const newOrg = async () => {
    const u = await createTestUser(db);
    const org = await createTestOrg(db, u.id);
    return {
      id: org.id,
      actor: {
        userId: u.id,
        organizationId: asOrganizationId(org.id),
        role: "owner",
      } as Actor,
    };
  };

  it("the manifest lists 131 unique, importable entries", async () => {
    const m = await readManifest(PACKS);
    expect(m).toHaveLength(131);
    expect(new Set(m.map((e) => e.slug)).size).toBe(131);
    expect(new Set(m.map((e) => e.ad.toLowerCase())).size).toBe(131);
    for (const slug of THREE) expect(m.map((e) => e.slug)).toContain(slug);
  });

  it("dry-run writes nothing", async () => {
    const o = await newOrg();
    const r = await importPacks({
      deps: deps(),
      organizationId: o.id,
      packsDir: PACKS,
      only: THREE,
      dryRun: true,
    });
    expect(r.map((x) => x.status)).toEqual([
      "would_import",
      "would_import",
      "would_import",
    ]);
    expect(
      await db.select().from(templates).where(eq(templates.organizationId, o.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(assets).where(eq(assets.organizationId, o.id)),
    ).toHaveLength(0);
  });

  it("imports packs with images, merge tags and an unsubscribe link, and is idempotent", async () => {
    const o = await newOrg();
    const m = await readManifest(PACKS);
    const run = () =>
      importPacks({ deps: deps(), organizationId: o.id, packsDir: PACKS, only: THREE });
    const first = await run();
    expect(first.map((x) => x.status)).toEqual(["imported", "imported", "imported"]);
    for (const r of first)
      expect(r.warnings.filter((w) => !EXPECTED_WARNING.test(w))).toEqual([]);

    const rows = await db
      .select()
      .from(templates)
      .where(eq(templates.organizationId, o.id));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.category))).toEqual(
      new Set(THREE.map((s) => m.find((e) => e.slug === s)!.kategori)),
    );
    const imageCount = first.reduce((n, r) => n + r.images, 0);
    expect(imageCount).toBeGreaterThan(0);
    expect(
      await db.select().from(assets).where(eq(assets.organizationId, o.id)),
    ).toHaveLength(imageCount);

    for (const row of rows) {
      const got = await getTemplateFor(deps(), o.actor, row.id);
      if (!got.ok) throw new Error("get failed");
      const html = got.doc.raw!.html;
      expect(html).not.toMatch(/<script|onclick=|javascript:/i);
      expect(html).toMatch(/\{\{\s*first_name/);
      expect(html).toContain("{{unsubscribe_url}}");
      expect(html).not.toMatch(/src="images\//); // every local image was rewritten to our own asset
      expect(html).toMatch(/src="\/a\/[0-9a-f-]{36}"/);
      expect(docHasUnsubscribe(got.doc)).toBe(true);
      const rendered = renderEmail(got.doc, {
        appUrl: "https://app.test",
        values: buildMergeValues(
          { firstName: "Ayşe", email: "a@b.co" },
          {
            unsubscribeUrl: "https://app.test/u/x",
            viewInBrowserUrl: "https://app.test/v/x",
            orgName: "Acme",
          },
        ),
      });
      expect(rendered.html).toContain("https://app.test/u/x");
      expect(rendered.html).not.toContain("{{");
    }

    const second = await run();
    expect(second.map((x) => x.status)).toEqual([
      "skipped_exists",
      "skipped_exists",
      "skipped_exists",
    ]);
    expect(
      await db.select().from(templates).where(eq(templates.organizationId, o.id)),
    ).toHaveLength(3);
  });

  it("requires an organization with an owner", async () => {
    await expect(
      importPacks({
        deps: deps(),
        organizationId: "00000000-0000-4000-8000-000000000000",
        packsDir: PACKS,
        only: THREE,
      }),
    ).rejects.toThrow(/no active owner/);
  });

  it("rejects unknown slugs", async () => {
    const o = await newOrg();
    await expect(
      importPacks({
        deps: deps(),
        organizationId: o.id,
        packsDir: PACKS,
        only: ["nope"],
      }),
    ).rejects.toThrow(/Unknown slug/);
  });
});
