import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  asOrganizationId,
  createDb,
  getAssetPublic,
  templates,
  templateVersions,
  type Database,
} from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import {
  createBlock,
  type EmailDoc,
  type OrgRole,
  type ParagraphBlock,
} from "@mailory/core";
import type { BrandKitInput } from "@mailory/validation";
import type { Actor } from "../org/service";
import * as svc from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

// Smallest valid-looking files (signatures are what we verify).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
);

const brand = (over: Partial<BrandKitInput> = {}): BrandKitInput => ({
  logoAssetId: null,
  primaryColor: "#0a7f5a",
  textColor: "#222222",
  backgroundColor: "#ffffff",
  linkColor: "#0a7f5a",
  buttonColor: "#0a7f5a",
  buttonTextColor: "#ffffff",
  font: "georgia",
  buttonRadius: 8,
  footerText: "Acme A.Ş.\nAnkara",
  socialLinks: [{ network: "linkedin", url: "https://linkedin.com/company/acme" }],
  ...over,
});

suite("template service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  const deps = () => ({ db, appUrl: "https://app.test" });

  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  const actorFor = (userId: string, organizationId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(organizationId),
    role,
  });
  async function tenant() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    return { user, org, actor: actorFor(user.id, org.id, "owner") };
  }
  async function memberOf(orgId: string, role: OrgRole) {
    const u = await createTestUser(db);
    await addTestMember(db, orgId, u.id, role);
    return actorFor(u.id, orgId, role);
  }
  const name = () => `Şablon ${randomUUID().slice(0, 8)}`;
  async function makeTemplate(
    actor: Actor,
    input: Partial<Parameters<typeof svc.createTemplateFor>[2]> = {},
  ) {
    const r = await svc.createTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      ...input,
    });
    if (!r.ok) throw new Error(`create failed: ${r.code}`);
    return r.id;
  }
  const load = async (actor: Actor, id: string) => {
    const r = await svc.getTemplateFor(deps(), actor, id);
    if (!r.ok) throw new Error(`load failed: ${r.code}`);
    return r;
  };
  const edited = (doc: EmailDoc, text: string): EmailDoc => ({
    ...doc,
    blocks: [
      ...doc.blocks.slice(0, -1),
      { ...(createBlock("paragraph") as ParagraphBlock), text },
      doc.blocks.at(-1)!,
    ],
  });

  describe("creation and brand kit", () => {
    it("creates a blank branded template with the unsubscribe footer", async () => {
      const { actor } = await tenant();
      await svc.saveBrandKit(deps(), actor, brand());
      const id = await makeTemplate(actor);
      const t = await load(actor, id);
      expect(t.version).toBe(1);
      expect(t.doc.settings).toMatchObject({
        buttonColor: "#0a7f5a",
        font: "georgia",
        radius: 8,
      });
      expect(t.doc.blocks.at(-1)).toMatchObject({
        type: "footer",
        showUnsubscribe: true,
        text: "Acme A.Ş.\nAnkara",
      });
    });
    it("creates from a library template and inherits its category; unknown keys fail", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor, { libraryKey: "event" });
      const t = await load(actor, id);
      expect(t.template).toMatchObject({
        category: "event",
        sourceLibraryKey: "event",
      });
      expect(JSON.stringify(t.doc)).toContain("Etkinlik");
      expect(
        await svc.createTemplateFor(deps(), actor, {
          name: name(),
          category: "other",
          libraryKey: "nope",
        }),
      ).toMatchObject({ ok: false, code: "not_found" });
    });
    it("a new template picks up the brand logo", async () => {
      const { actor } = await tenant();
      const asset = await svc.uploadAsset(deps(), actor, {
        bytes: PNG,
        filename: "logo.png",
      });
      if (!asset.ok) throw new Error("upload failed");
      await svc.saveBrandKit(deps(), actor, brand({ logoAssetId: asset.id }));
      const t = await load(actor, await makeTemplate(actor, { libraryKey: "welcome" }));
      expect(t.doc.blocks[0]).toMatchObject({ type: "logo", src: `/a/${asset.id}` });
    });
    it("rejects duplicate live names case-insensitively; archiving frees the name", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor, { name: "Bülten" });
      expect(
        await svc.createTemplateFor(deps(), actor, {
          name: "BÜLTEN",
          category: "other",
        }),
      ).toMatchObject({ ok: false, code: "duplicate" });
      expect((await svc.archiveTemplateFor(deps(), actor, id, true)).ok).toBe(true);
      expect(
        (
          await svc.createTemplateFor(deps(), actor, {
            name: "Bülten",
            category: "other",
          })
        ).ok,
      ).toBe(true);
      // Restoring now collides with the live one.
      expect(await svc.archiveTemplateFor(deps(), actor, id, false)).toMatchObject({
        ok: false,
        code: "duplicate",
      });
    });
    it("archived templates leave the default list and appear in the archive list", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor);
      await svc.archiveTemplateFor(deps(), actor, id, true);
      const live = await svc.listTemplatesFor(deps(), actor);
      const archived = await svc.listTemplatesFor(deps(), actor, { archived: true });
      expect(live.ok && live.templates.map((t) => t.id)).not.toContain(id);
      expect(archived.ok && archived.templates.map((t) => t.id)).toContain(id);
    });
  });

  describe("versioning", () => {
    it("every save appends an immutable version; the current content is the latest", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor);
      const v1 = await load(actor, id);
      expect(
        await svc.saveTemplateFor(deps(), actor, id, {
          doc: edited(v1.doc, "ikinci"),
          expectedVersion: 1,
        }),
      ).toEqual({ ok: true, version: 2 });
      expect(
        await svc.saveTemplateFor(deps(), actor, id, {
          doc: edited(v1.doc, "üçüncü"),
          expectedVersion: 2,
        }),
      ).toEqual({ ok: true, version: 3 });
      expect(JSON.stringify((await load(actor, id)).doc)).toContain("üçüncü");
      const versions = await svc.listVersionsFor(deps(), actor, id);
      expect(versions.ok && versions.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    });
    it("detects a lost update: saving against a stale version is a conflict, not an overwrite", async () => {
      const { actor, org } = await tenant();
      const other = await memberOf(org.id, "editor");
      const id = await makeTemplate(actor);
      const base = await load(actor, id);
      expect(
        (
          await svc.saveTemplateFor(deps(), other, id, {
            doc: edited(base.doc, "editörün değişikliği"),
            expectedVersion: 1,
          })
        ).ok,
      ).toBe(true);
      const stale = await svc.saveTemplateFor(deps(), actor, id, {
        doc: edited(base.doc, "sahibin eski kopyası"),
        expectedVersion: 1,
      });
      expect(stale).toMatchObject({ ok: false, code: "conflict", currentVersion: 2 });
      expect(JSON.stringify((await load(actor, id)).doc)).toContain(
        "editörün değişikliği",
      );
    });
    it("a save waits for the template row lock, so concurrent saves are serialized (deterministic)", async () => {
      // Hold a FOR KEY SHARE lock on the template row. It conflicts ONLY with FOR UPDATE (not with the
      // save's own non-key UPDATE), so a save that blocks here is blocked by its FOR UPDATE select.
      // Without FOR UPDATE the save finishes immediately and this fails.
      const { actor, org } = await tenant();
      const id = await makeTemplate(actor);
      const base = await load(actor, id);
      const sleep = (ms: number) =>
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), ms));

      let save!: ReturnType<typeof svc.saveTemplateFor>;
      let state: unknown;
      await db.transaction(async (tx) => {
        await tx
          .select({ id: templates.id })
          .from(templates)
          .where(and(eq(templates.organizationId, org.id), eq(templates.id, id)))
          .for("key share");
        save = svc.saveTemplateFor(deps(), actor, id, {
          doc: edited(base.doc, "kilit sonrası"),
          expectedVersion: 1,
        });
        state = await Promise.race([save, sleep(400)]);
      });
      expect(state).toBe("blocked");
      expect(await save).toEqual({ ok: true, version: 2 });
    });
    it("of two saves from the same base version, the second is a conflict (serialized outcome)", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor);
      const base = await load(actor, id);
      const first = await svc.saveTemplateFor(deps(), actor, id, {
        doc: edited(base.doc, "A"),
        expectedVersion: 1,
      });
      const second = await svc.saveTemplateFor(deps(), actor, id, {
        doc: edited(base.doc, "B"),
        expectedVersion: 1,
      });
      expect(first).toEqual({ ok: true, version: 2 });
      expect(second).toMatchObject({ ok: false, code: "conflict", currentVersion: 2 });
    });
    it("restoring appends a new version with the old content; history is never rewritten", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor);
      const v1 = await load(actor, id);
      await svc.saveTemplateFor(deps(), actor, id, { doc: edited(v1.doc, "değişti") });
      const versions = await svc.listVersionsFor(deps(), actor, id);
      if (!versions.ok) throw new Error("list failed");
      const first = versions.versions.find((v) => v.version === 1)!;
      expect(await svc.restoreVersionFor(deps(), actor, id, first.id)).toEqual({
        ok: true,
        version: 3,
      });
      const now = await load(actor, id);
      expect(now.version).toBe(3);
      expect(JSON.stringify(now.doc)).not.toContain("değişti");
      const after = await svc.listVersionsFor(deps(), actor, id);
      expect(after.ok && after.versions.map((v) => v.version)).toEqual([3, 2, 1]);
      expect(after.ok && after.versions[0]!.note).toBe("Sürüm 1 geri yüklendi");
    });
    it("keeps history bounded to 50 versions, never pruning the current one", async () => {
      const { actor, org } = await tenant();
      const id = await makeTemplate(actor);
      const base = await load(actor, id);
      for (let i = 0; i < 55; i++)
        await svc.saveTemplateFor(deps(), actor, id, {
          doc: edited(base.doc, `v${i}`),
        });
      const rows = await db
        .select({ n: count() })
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, id),
            eq(templateVersions.organizationId, org.id),
          ),
        );
      expect(rows[0]!.n).toBeLessThanOrEqual(50);
      expect((await load(actor, id)).version).toBe(56);
    });
    it("rejects an invalid document and leaves the template untouched", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor);
      const base = await load(actor, id);
      const bad = {
        ...base.doc,
        blocks: [{ ...createBlock("button"), href: "javascript:alert(1)" }],
      };
      expect(await svc.saveTemplateFor(deps(), actor, id, { doc: bad })).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect((await load(actor, id)).version).toBe(1);
    });
    it("duplicate copies the current content under a new name", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor, { libraryKey: "newsletter" });
      const base = await load(actor, id);
      await svc.saveTemplateFor(deps(), actor, id, {
        doc: edited(base.doc, "özel metin"),
      });
      const dup = await svc.duplicateTemplateFor(deps(), actor, id, "Kopya");
      if (!dup.ok) throw new Error("duplicate failed");
      const copy = await load(actor, dup.id);
      expect(JSON.stringify(copy.doc)).toContain("özel metin");
      expect(copy.version).toBe(1);
      expect(await svc.duplicateTemplateFor(deps(), actor, id, "Kopya")).toMatchObject({
        code: "duplicate",
      });
    });
  });

  describe("authorization", () => {
    it("viewers can read but not create, save, duplicate, archive or upload", async () => {
      const { actor, org } = await tenant();
      const id = await makeTemplate(actor);
      const viewer = await memberOf(org.id, "viewer");
      expect((await svc.getTemplateFor(deps(), viewer, id)).ok).toBe(true);
      expect((await svc.listTemplatesFor(deps(), viewer)).ok).toBe(true);
      expect(
        await svc.createTemplateFor(deps(), viewer, {
          name: name(),
          category: "other",
        }),
      ).toMatchObject({ code: "forbidden" });
      expect(
        await svc.saveTemplateFor(deps(), viewer, id, {
          doc: (await load(actor, id)).doc,
        }),
      ).toMatchObject({ code: "forbidden" });
      expect(await svc.duplicateTemplateFor(deps(), viewer, id, "x")).toMatchObject({
        code: "forbidden",
      });
      expect(await svc.archiveTemplateFor(deps(), viewer, id, true)).toMatchObject({
        code: "forbidden",
      });
      expect(
        await svc.uploadAsset(deps(), viewer, { bytes: PNG, filename: "a.png" }),
      ).toMatchObject({ code: "forbidden" });
    });
    it("editors can author templates and upload images but cannot change the brand kit; admins can", async () => {
      const { org } = await tenant();
      const editor = await memberOf(org.id, "editor");
      const admin = await memberOf(org.id, "admin");
      expect(
        await svc.createTemplateFor(deps(), editor, {
          name: name(),
          category: "other",
        }),
      ).toMatchObject({ ok: true });
      expect(
        (await svc.uploadAsset(deps(), editor, { bytes: PNG, filename: "a.png" })).ok,
      ).toBe(true);
      expect(await svc.saveBrandKit(deps(), editor, brand())).toMatchObject({
        code: "forbidden",
      });
      expect((await svc.getBrandKit(deps(), editor)).ok).toBe(true);
      expect((await svc.saveBrandKit(deps(), admin, brand())).ok).toBe(true);
    });
  });

  describe("tenant isolation (cross-tenant / IDOR)", () => {
    it("never reads, saves, restores, duplicates, archives or lists another organization's templates", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const bId = await makeTemplate(b, { libraryKey: "newsletter" });
      const bDoc = (await load(b, bId)).doc;
      const bVersions = await svc.listVersionsFor(deps(), b, bId);
      if (!bVersions.ok) throw new Error("setup failed");

      expect(await svc.getTemplateFor(deps(), a, bId)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(
        await svc.saveTemplateFor(deps(), a, bId, { doc: bDoc, name: "hijack" }),
      ).toMatchObject({ ok: false, code: "not_found" });
      expect(await svc.listVersionsFor(deps(), a, bId)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(
        await svc.restoreVersionFor(deps(), a, bId, bVersions.versions[0]!.id),
      ).toMatchObject({ ok: false, code: "not_found" });
      expect(await svc.duplicateTemplateFor(deps(), a, bId, "steal")).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await svc.archiveTemplateFor(deps(), a, bId, true)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      const list = await svc.listTemplatesFor(deps(), a);
      expect(list.ok && list.templates).toHaveLength(0);

      const intact = await load(b, bId);
      expect(intact.template.name).not.toBe("hijack");
      expect(intact.template.archivedAt).toBeNull();
      expect(intact.version).toBe(1);
    });
    it("a foreign version id of one's OWN template cannot be restored from another org's template", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const aId = await makeTemplate(a);
      const bId = await makeTemplate(b);
      const bVersions = await svc.listVersionsFor(deps(), b, bId);
      if (!bVersions.ok) throw new Error("setup failed");
      // A names its own template but B's version id: must not copy B's content.
      expect(
        await svc.restoreVersionFor(deps(), a, aId, bVersions.versions[0]!.id),
      ).toMatchObject({ ok: false, code: "not_found" });
    });
    it("brand kits are per organization, and a foreign logo asset id is never linked", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const bAsset = await svc.uploadAsset(deps(), b, {
        bytes: PNG,
        filename: "b.png",
      });
      if (!bAsset.ok) throw new Error("upload failed");
      await svc.saveBrandKit(
        deps(),
        b,
        brand({ primaryColor: "#111111", buttonColor: "#111111" }),
      );
      await svc.saveBrandKit(deps(), a, brand({ logoAssetId: bAsset.id }));
      const aKit = await svc.getBrandKit(deps(), a);
      expect(aKit.ok && aKit.brand.logoAssetId).toBeNull();
      expect(aKit.ok && aKit.brand.primaryColor).toBe("#0a7f5a");
      const bKit = await svc.getBrandKit(deps(), b);
      expect(bKit.ok && bKit.brand.primaryColor).toBe("#111111");
    });
    it("an unconfigured organization gets the default brand, not another tenant's", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      await svc.saveBrandKit(
        deps(),
        actorFor(ownerA.id, orgA.id, "owner"),
        brand({ footerText: "A'nın adresi" }),
      );
      const kit = await svc.getBrandKit(deps(), actorFor(ownerB.id, orgB.id, "owner"));
      expect(kit).toMatchObject({ ok: true, configured: false });
      expect(kit.ok && kit.brand.footerText).toBe("");
    });
  });

  describe("assets", () => {
    it("stores a verified image and serves it publicly by id with the sniffed type", async () => {
      const { actor } = await tenant();
      const r = await svc.uploadAsset(deps(), actor, {
        bytes: PNG,
        filename: "Logo (final).png",
      });
      if (!r.ok) throw new Error("upload failed");
      expect(r.url).toBe(`/a/${r.id}`);
      const served = await getAssetPublic(db, r.id);
      expect(served?.contentType).toBe("image/png");
      expect(served?.data.equals(PNG)).toBe(true);
    });
    it("rejects SVG, HTML, empty and oversized uploads, ignoring the filename extension", async () => {
      const { actor } = await tenant();
      expect(
        await svc.uploadAsset(deps(), actor, { bytes: SVG, filename: "x.png" }),
      ).toMatchObject({ ok: false, code: "invalid" });
      expect(
        await svc.uploadAsset(deps(), actor, {
          bytes: Buffer.from("<html><script>alert(1)</script>"),
          filename: "x.jpg",
        }),
      ).toMatchObject({ code: "invalid" });
      expect(
        await svc.uploadAsset(deps(), actor, {
          bytes: Buffer.alloc(0),
          filename: "x.png",
        }),
      ).toMatchObject({ code: "invalid" });
      expect(
        await svc.uploadAsset(deps(), actor, {
          bytes: Buffer.concat([PNG, Buffer.alloc(svc.MAX_ASSET_BYTES)]),
          filename: "big.png",
        }),
      ).toMatchObject({ code: "too_large" });
    });
    it("unknown asset ids serve nothing", async () => {
      expect(await getAssetPublic(db, randomUUID())).toBeNull();
    });
  });

  describe("preview", () => {
    it("renders with sample personalization and flags unknown merge fields", async () => {
      const { actor } = await tenant();
      const id = await makeTemplate(actor);
      const doc = edited(
        (await load(actor, id)).doc,
        "Merhaba {{first_name}} — {{bogus_field}} — {{custom.stage}}",
      );
      const r = await svc.previewTemplate(deps(), actor, doc);
      if (!r.ok) throw new Error("preview failed");
      expect(r.html).toContain("Merhaba Ayşe");
      expect(r.unknownKeys.sort()).toEqual(["bogus_field", "custom.stage"]);
    });
    it("knows the organization's own custom fields", async () => {
      const { actor } = await tenant();
      const { createFieldFor } = await import("../audience/service");
      await createFieldFor({ db }, actor, {
        key: "stage",
        label: "Aşama",
        type: "text",
      });
      const id = await makeTemplate(actor);
      const r = await svc.previewTemplate(
        deps(),
        actor,
        edited((await load(actor, id)).doc, "Aşama: {{custom.stage}}"),
      );
      expect(r.ok && r.unknownKeys).toEqual([]);
    });
    it("rejects an invalid document", async () => {
      const { actor } = await tenant();
      expect(await svc.previewTemplate(deps(), actor, { version: 1 })).toMatchObject({
        ok: false,
        code: "invalid",
      });
    });
    it("viewers may preview", async () => {
      const { actor, org } = await tenant();
      const id = await makeTemplate(actor);
      const viewer = await memberOf(org.id, "viewer");
      expect(
        (await svc.previewTemplate(deps(), viewer, (await load(actor, id)).doc)).ok,
      ).toBe(true);
    });
  });
});
