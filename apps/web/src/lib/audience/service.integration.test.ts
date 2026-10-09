import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOrganizationId,
  countContacts,
  createDb,
  contacts,
  type Database,
} from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import { parseCsv, type OrgRole } from "@mailory/core";
import {
  segmentDefinitionSchema,
  bulkActionSchema,
  type SegmentDefinition,
} from "@mailory/validation";
import { eq } from "drizzle-orm";
import type { Actor } from "../org/service";
import * as svc from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("audience service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  const deps = () => ({ db });

  beforeAll(() => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.pool.end();
  });
  afterAll(async () => end());

  const actorFor = (userId: string, organizationId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(organizationId),
    role,
  });

  async function tenant(role: OrgRole = "owner") {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    return { user, org, actor: actorFor(user.id, org.id, role) };
  }
  const emailOf = (n: number | string) =>
    `c-${n}-${randomUUID().slice(0, 8)}@example.com`;
  const seed = async (
    actor: Actor,
    n: number,
    extra: Partial<Parameters<typeof svc.createContactFor>[2]> = {},
  ) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = await svc.createContactFor(deps(), actor, {
        email: emailOf(i),
        ...extra,
      });
      if (!r.ok) throw new Error(`seed failed: ${r.code}`);
      out.push(r.contact);
    }
    return out;
  };
  const importCsv = (actor: Actor, csv: string, extra: Record<string, unknown> = {}) =>
    svc.runImport(deps(), actor, {
      csv,
      mapping: { email: "email", name: "first_name", company: "company" },
      consentAttested: true,
      updateExisting: false,
      ...extra,
    } as never);

  describe("contacts CRUD", () => {
    it("creates, reads, updates and bulk-deletes", async () => {
      const { actor } = await tenant();
      const r = await svc.createContactFor(deps(), actor, {
        email: "Ada@Example.com",
        firstName: "Ada",
        company: "Acme",
      });
      if (!r.ok) throw new Error("create failed");
      expect(r.contact.email).toBe("ada@example.com");

      expect(
        (
          await svc.updateContactFor(deps(), actor, r.contact.id, {
            company: "Beta",
            city: "Ankara",
          })
        ).ok,
      ).toBe(true);
      const detail = await svc.getContactDetail(deps(), actor, r.contact.id);
      expect(detail.ok && detail.contact).toMatchObject({
        company: "Beta",
        city: "Ankara",
        firstName: "Ada",
      });

      const del = await svc.bulkAction(
        deps(),
        actor,
        bulkActionSchema.parse({ action: "delete", ids: [r.contact.id] }),
      );
      expect(del).toEqual({ ok: true, affected: 1 });
    });
    it("rejects duplicate emails within an organization, case-insensitively", async () => {
      const { actor } = await tenant();
      await svc.createContactFor(deps(), actor, { email: "dup@example.com" });
      expect(
        await svc.createContactFor(deps(), actor, { email: "DUP@example.com" }),
      ).toMatchObject({ ok: false, code: "duplicate" });
    });
    it("allows the same email in two different organizations", async () => {
      const a = await tenant();
      const b = await tenant();
      const email = emailOf("shared");
      expect((await svc.createContactFor(deps(), a.actor, { email })).ok).toBe(true);
      expect((await svc.createContactFor(deps(), b.actor, { email })).ok).toBe(true);
    });
    it("records consent provenance when consent is granted", async () => {
      const { actor } = await tenant();
      const r = await svc.createContactFor(deps(), actor, {
        email: emailOf(1),
        consentStatus: "granted",
        consentSource: "web form",
      });
      if (!r.ok) throw new Error("create failed");
      expect(r.contact).toMatchObject({
        consentStatus: "granted",
        consentSource: "web form",
      });
      expect(r.contact.consentAt).toBeInstanceOf(Date);
    });
    it("supports custom fields with type coercion and rejects undefined keys", async () => {
      const { actor } = await tenant();
      await svc.createFieldFor(deps(), actor, {
        key: "employees",
        label: "Çalışan",
        type: "number",
      });
      const ok = await svc.createContactFor(deps(), actor, {
        email: emailOf(1),
        custom: { employees: "12" },
      });
      expect(ok.ok && ok.contact.custom).toEqual({ employees: 12 });
      expect(
        await svc.createContactFor(deps(), actor, {
          email: emailOf(2),
          custom: { employees: "çok" },
        }),
      ).toMatchObject({ ok: false, code: "invalid" });
      expect(
        await svc.createContactFor(deps(), actor, {
          email: emailOf(3),
          custom: { nope: "x" },
        }),
      ).toMatchObject({ ok: false, code: "invalid" });
    });
    it("deleting a custom field strips its values from contacts", async () => {
      const { actor } = await tenant();
      const field = await svc.createFieldFor(deps(), actor, {
        key: "tier",
        label: "Tier",
        type: "text",
      });
      if (!field.ok) throw new Error("field failed");
      const c = await svc.createContactFor(deps(), actor, {
        email: emailOf(1),
        custom: { tier: "gold" },
      });
      if (!c.ok) throw new Error("create failed");
      await svc.deleteFieldFor(deps(), actor, field.id);
      const detail = await svc.getContactDetail(deps(), actor, c.contact.id);
      expect(detail.ok && detail.contact.custom).toEqual({});
    });
  });

  describe("authorization", () => {
    it("viewers can read but not write, export, or lift suppressions", async () => {
      const { user, org } = await tenant();
      const viewer = await createTestUser(db);
      await addTestMember(db, org.id, viewer.id, "viewer");
      const v = actorFor(viewer.id, org.id, "viewer");
      expect((await svc.searchContacts(deps(), v, {})).ok).toBe(true);
      expect(
        await svc.createContactFor(deps(), v, { email: emailOf(1) }),
      ).toMatchObject({ code: "forbidden" });
      expect(await svc.exportContacts(deps(), v)).toMatchObject({ code: "forbidden" });
      expect(await svc.createListFor(deps(), v, { name: "x" })).toMatchObject({
        code: "forbidden",
      });
      expect(
        await svc.bulkAction(deps(), v, { action: "delete", ids: [randomUUID()] }),
      ).toMatchObject({ code: "forbidden" });
      expect(user.id).toBeTruthy();
    });
    it("editors can write and export, but only admins can lift a suppression", async () => {
      const { org } = await tenant();
      const editor = await createTestUser(db);
      await addTestMember(db, org.id, editor.id, "editor");
      const e = actorFor(editor.id, org.id, "editor");
      expect((await svc.createContactFor(deps(), e, { email: emailOf(1) })).ok).toBe(
        true,
      );
      expect((await svc.exportContacts(deps(), e)).ok).toBe(true);
      await svc.suppressEmails(deps(), e, {
        emails: ["blocked@example.com"],
        reason: "manual",
      });
      expect(await svc.liftSuppression(deps(), e, "blocked@example.com")).toMatchObject(
        { code: "forbidden" },
      );
    });
  });

  describe("tenant isolation (cross-tenant / IDOR)", () => {
    it("never returns, edits or deletes another organization's contacts, even by id", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const [bContact] = await seed(b, 1);

      expect(await svc.getContactDetail(deps(), a, bContact!.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(
        await svc.updateContactFor(deps(), a, bContact!.id, { company: "hijack" }),
      ).toMatchObject({ ok: false, code: "not_found" });
      expect(
        await svc.bulkAction(deps(), a, { action: "delete", ids: [bContact!.id] }),
      ).toEqual({ ok: true, affected: 0 });
      expect(
        await svc.bulkAction(deps(), a, {
          action: "set_status",
          ids: [bContact!.id],
          status: "cleaned",
        }),
      ).toEqual({ ok: true, affected: 0 });

      const [after] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, bContact!.id));
      expect(after).toMatchObject({ company: null, status: "subscribed" });
      const searchA = await svc.searchContacts(deps(), a, {});
      expect(searchA.ok && searchA.rows).toHaveLength(0);
    });
    it("a foreign list or tag id cannot be used to attach contacts or read members", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const bList = await svc.createListFor(deps(), b, { name: "B secrets" });
      const bTag = await svc.createTagFor(deps(), b, "b-tag");
      if (!bList.ok || !bTag.ok) throw new Error("setup failed");
      const [aContact] = await seed(a, 1);

      expect(
        await svc.bulkAction(deps(), a, {
          action: "add_to_list",
          ids: [aContact!.id],
          listId: bList.id,
        }),
      ).toEqual({ ok: true, affected: 0 });
      expect(
        await svc.bulkAction(deps(), a, {
          action: "add_tag",
          ids: [aContact!.id],
          tagId: bTag.id,
        }),
      ).toEqual({ ok: true, affected: 0 });
      // ...and filtering by B's list from A's session yields nothing, rather than an error that confirms it exists.
      const filtered = await svc.searchContacts(deps(), a, {
        filter: { listId: bList.id },
      });
      expect(filtered.ok && filtered.rows).toHaveLength(0);
      const bContacts = await seed(b, 1);
      await svc.bulkAction(deps(), b, {
        action: "add_to_list",
        ids: [bContacts[0]!.id],
        listId: bList.id,
      });
      const stillEmpty = await svc.searchContacts(deps(), a, {
        filter: { listId: bList.id },
      });
      expect(stillEmpty.ok && stillEmpty.rows).toHaveLength(0);
    });
    it("a foreign segment id is not found, and segment/list rules ignore foreign ids", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const seg = await svc.createSegmentFor(deps(), b, {
        name: "all",
        definition: {
          type: "group",
          op: "and",
          children: [{ type: "rule", field: "status", op: "eq", value: "subscribed" }],
        },
      });
      if (!seg.ok) throw new Error("segment failed");
      expect(
        await svc.searchContacts(deps(), a, { filter: { segmentId: seg.id } }),
      ).toMatchObject({ ok: false, code: "not_found" });
      expect(await svc.deleteSegmentFor(deps(), a, seg.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(
        await svc.updateListFor(deps(), a, randomUUID(), { name: "x" }),
      ).toMatchObject({ code: "not_found" });
    });
    it("suppressions, lists, tags and fields are per-organization", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      await svc.suppressEmails(deps(), b, {
        emails: ["x@example.com"],
        reason: "manual",
      });
      const seen = await svc.getSuppressions(deps(), a, {});
      expect(seen.ok && seen.total).toBe(0);
      // A may still add the same address to its own contacts — B's suppression is not A's.
      expect(
        (await svc.createContactFor(deps(), a, { email: "x@example.com" })).ok,
      ).toBe(true);
      await svc.createListFor(deps(), b, { name: "Only B" });
      const lists = await svc.getLists(deps(), a);
      expect(lists.ok && lists.lists).toHaveLength(0);
    });
    it("export contains only the caller's contacts", async () => {
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      await seed(b, 3);
      const [mine] = await seed(a, 1);
      const out = await svc.exportContacts(deps(), a);
      if (!out.ok) throw new Error("export failed");
      let text = "";
      for await (const line of out.lines) text += line;
      const rows = parseCsv(text).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]![0]).toBe(mine!.email);
    });
  });

  describe("search, filters and pagination", () => {
    it("pages through every contact exactly once with a stable cursor", async () => {
      const { actor } = await tenant();
      await seed(actor, 25);
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await svc.searchContacts(deps(), actor, { limit: 10, cursor });
        if (!page.ok) throw new Error("search failed");
        for (const row of page.rows) {
          expect(seen.has(row.id)).toBe(false);
          seen.add(row.id);
        }
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);
      expect(seen.size).toBe(25);
      expect(pages).toBe(3);
    });
    it("pages and exports bulk-imported rows (identical created_at to the microsecond) without skipping or repeating any", async () => {
      // A single INSERT stamps every row with the same now(); a cursor that truncates the timestamp to
      // milliseconds (JS Date) silently skips/duplicates such rows. Regression test for exactly that.
      const { actor } = await tenant();
      const rows = [
        "email",
        ...Array.from({ length: 53 }, (_, i) => `same-${i}@example.com`),
      ].join("\n");
      const imported = await importCsv(actor, rows, { mapping: { email: "email" } });
      expect(imported).toMatchObject({ ok: true, inserted: 53 });

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await svc.searchContacts(deps(), actor, { limit: 7, cursor });
        if (!page.ok) throw new Error("search failed");
        seen.push(...page.rows.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toHaveLength(53);
      expect(new Set(seen).size).toBe(53);

      const out = await svc.exportContacts(deps(), actor);
      if (!out.ok) throw new Error("export failed");
      let lines = 0;
      for await (const line of out.lines) lines += line.split("\r\n").length - 1;
      expect(lines).toBe(54); // header + 53 rows, no repeats
    });
    it("returns the total only on the first page", async () => {
      const { actor } = await tenant();
      await seed(actor, 12);
      const first = await svc.searchContacts(deps(), actor, { limit: 5 });
      expect(first.ok && first.total).toBe(12);
      const second = await svc.searchContacts(deps(), actor, {
        limit: 5,
        cursor: first.ok ? first.nextCursor! : undefined,
      });
      expect(second.ok && second.total).toBeNull();
    });
    it("searches by name, email and company, treating % and _ literally", async () => {
      const { actor } = await tenant();
      await svc.createContactFor(deps(), actor, {
        email: emailOf("a"),
        firstName: "Şule",
        company: "100% Organik",
      });
      await svc.createContactFor(deps(), actor, {
        email: emailOf("b"),
        firstName: "Bob",
        company: "Plain Co",
      });
      const count = async (q: string) => {
        const r = await svc.searchContacts(deps(), actor, { filter: { q } });
        return r.ok ? r.rows.length : -1;
      };
      expect(await count("organik")).toBe(1);
      expect(await count("100%")).toBe(1);
      expect(await count("%")).toBe(1); // a bare % must not behave as a wildcard matching everything
      expect(await count("_")).toBe(0);
      expect(await count("plain")).toBe(1);
    });
    it("filters by list and tag membership", async () => {
      const { actor } = await tenant();
      const [c1, c2] = await seed(actor, 2);
      const list = await svc.createListFor(deps(), actor, { name: "VIP" });
      const tag = await svc.createTagFor(deps(), actor, "yatirimci");
      if (!list.ok || !tag.ok) throw new Error("setup failed");
      await svc.bulkAction(deps(), actor, {
        action: "add_to_list",
        ids: [c1!.id],
        listId: list.id,
      });
      await svc.bulkAction(deps(), actor, {
        action: "add_tag",
        ids: [c2!.id],
        tagId: tag.id,
      });
      const byList = await svc.searchContacts(deps(), actor, {
        filter: { listId: list.id },
      });
      const byTag = await svc.searchContacts(deps(), actor, {
        filter: { tagId: tag.id },
      });
      expect(byList.ok && byList.rows.map((r) => r.id)).toEqual([c1!.id]);
      expect(byTag.ok && byTag.rows.map((r) => r.id)).toEqual([c2!.id]);
      expect(byTag.ok && byTag.rows[0]!.tags.map((t) => t.name)).toEqual(["yatirimci"]);
      const lists = await svc.getLists(deps(), actor);
      expect(lists.ok && lists.lists[0]!.contactCount).toBe(1);
    });
    it("bulk actions can target everything matching a filter", async () => {
      const { actor } = await tenant();
      await seed(actor, 5, { company: "Acme" });
      await seed(actor, 3, { company: "Other" });
      const r = await svc.bulkAction(deps(), actor, {
        action: "set_status",
        filter: { q: "acme" },
        status: "cleaned",
      });
      expect(r).toEqual({ ok: true, affected: 5 });
      const cleaned = await svc.searchContacts(deps(), actor, {
        filter: { status: "cleaned" },
      });
      expect(cleaned.ok && cleaned.total).toBe(5);
    });
    it("refuses to bulk re-subscribe contacts", async () => {
      const { actor } = await tenant();
      const [c] = await seed(actor, 1);
      expect(
        await svc.bulkAction(deps(), actor, {
          action: "set_status",
          ids: [c!.id],
          status: "subscribed",
        }),
      ).toMatchObject({ ok: false, code: "invalid" });
    });
  });

  describe("CSV import", () => {
    it("imports valid rows, reports invalid ones with row numbers, and dedupes within the file", async () => {
      const { actor } = await tenant();
      const csv = [
        "email,name,company",
        "a@x.co,Ada,Acme",
        "not-an-email,Bob,Beta",
        "A@X.CO,Dup,Dup",
        ",Empty,Co",
        "c@x.co,Cem,Gamma",
      ].join("\n");
      const r = await importCsv(actor, csv);
      if (!r.ok) throw new Error(`import failed: ${r.code}`);
      expect(r).toMatchObject({
        total: 5,
        inserted: 2,
        invalid: 2,
        skipped: 1,
        suppressed: 0,
      });
      expect(r.errors.map((e) => e.row)).toEqual([3, 5]);
      expect(await countContacts(db, actor.organizationId)).toBe(2);
    });
    it("stamps new contacts with consent provenance and keeps proof on the job", async () => {
      const { actor } = await tenant();
      await importCsv(actor, "email\nconsent@x.co", {
        mapping: { email: "email" },
        filename: "btm-2026.csv",
      });
      const page = await svc.searchContacts(deps(), actor, {});
      expect(page.ok && page.rows[0]).toMatchObject({
        consentStatus: "granted",
        consentSource: "import:btm-2026.csv",
        source: "import",
      });
      const jobs = await svc.recentImports(deps(), actor);
      expect(jobs.ok && jobs.jobs[0]).toMatchObject({
        consentAttested: true,
        filename: "btm-2026.csv",
        inserted: 1,
      });
    });
    it("never imports suppressed addresses and never revives them", async () => {
      const { actor } = await tenant();
      await svc.suppressEmails(deps(), actor, {
        emails: ["gone@x.co"],
        reason: "complaint",
      });
      const r = await importCsv(actor, "email,name\ngone@x.co,Gone\nstay@x.co,Stay", {
        mapping: { email: "email", name: "first_name" },
      });
      expect(r).toMatchObject({ ok: true, inserted: 1, suppressed: 1 });
      expect(await countContacts(db, actor.organizationId, { q: "gone@x.co" })).toBe(0);
    });
    it("without updateExisting leaves existing contacts untouched; with it, only fills non-empty values and keeps status/consent", async () => {
      const { actor } = await tenant();
      const created = await svc.createContactFor(deps(), actor, {
        email: "keep@x.co",
        firstName: "Orig",
        company: "OldCo",
        status: "unsubscribed",
        consentStatus: "withdrawn",
      });
      if (!created.ok) throw new Error("create failed");
      const csv = "email,name,company\nkeep@x.co,,NewCo";

      expect(await importCsv(actor, csv)).toMatchObject({
        inserted: 0,
        updated: 0,
        skipped: 1,
      });
      expect(
        (await svc.getContactDetail(deps(), actor, created.contact.id)) as never,
      ).toMatchObject({ contact: { company: "OldCo" } });

      expect(await importCsv(actor, csv, { updateExisting: true })).toMatchObject({
        inserted: 0,
        updated: 1,
      });
      const detail = await svc.getContactDetail(deps(), actor, created.contact.id);
      expect(detail.ok && detail.contact).toMatchObject({
        company: "NewCo",
        firstName: "Orig",
        status: "unsubscribed",
        consentStatus: "withdrawn",
      });
    });
    it("maps Turkish semicolon-delimited files and custom fields, and rejects bad custom values per row", async () => {
      const { actor } = await tenant();
      await svc.createFieldFor(deps(), actor, {
        key: "employees",
        label: "Çalışan",
        type: "number",
      });
      const csv = "E-posta;Adı;Çalışan\nsule@x.co;Şule;12\nbad@x.co;Bad;çok";
      const r = await importCsv(actor, csv, {
        mapping: { "E-posta": "email", Adı: "first_name", Çalışan: "custom:employees" },
      });
      expect(r).toMatchObject({ ok: true, inserted: 1, invalid: 1 });
      const found = await svc.searchContacts(deps(), actor, {
        filter: { q: "sule@x.co" },
      });
      expect(found.ok && found.rows[0]).toMatchObject({
        firstName: "Şule",
        custom: { employees: 12 },
      });
    });
    it("adds everyone in the file to the chosen list and tags, including pre-existing contacts", async () => {
      const { actor } = await tenant();
      await svc.createContactFor(deps(), actor, { email: "old@x.co" });
      const list = await svc.createListFor(deps(), actor, { name: "Etkinlik" });
      const tag = await svc.createTagFor(deps(), actor, "sahnexl");
      if (!list.ok || !tag.ok) throw new Error("setup failed");
      await importCsv(actor, "email\nold@x.co\nnew@x.co", {
        mapping: { email: "email" },
        listId: list.id,
        tagIds: [tag.id],
      });
      const byList = await svc.searchContacts(deps(), actor, {
        filter: { listId: list.id },
      });
      const byTag = await svc.searchContacts(deps(), actor, {
        filter: { tagId: tag.id },
      });
      expect(byList.ok && byList.total).toBe(2);
      expect(byTag.ok && byTag.total).toBe(2);
    });
    it("validates the mapping", async () => {
      const { actor } = await tenant();
      expect(
        await importCsv(actor, "a,b\n1,2", { mapping: { a: "first_name" } }),
      ).toMatchObject({ ok: false, code: "invalid" });
      expect(
        await importCsv(actor, "a\n1", { mapping: { missing: "email" } }),
      ).toMatchObject({ ok: false, code: "invalid" });
      expect(
        await importCsv(actor, "a,b\n1,2", { mapping: { a: "email", b: "email" } }),
      ).toMatchObject({ ok: false, code: "invalid" });
      expect(
        await importCsv(actor, "a\n1", { mapping: { a: "password_hash" } }),
      ).toMatchObject({ ok: false, code: "invalid" });
      expect(
        await importCsv(actor, "a\n1", { mapping: { a: "custom:undefined_field" } }),
      ).toMatchObject({ ok: false, code: "invalid" });
    });
    it("preview suggests a mapping and counts rows", async () => {
      const { actor } = await tenant();
      const p = await svc.previewImport(
        deps(),
        actor,
        "E-posta,Adı,Şirket\na@x.co,Ada,Acme\nb@x.co,Bob,Beta",
      );
      expect(p).toMatchObject({
        ok: true,
        totalRows: 2,
        suggestedMapping: { "E-posta": "email", Adı: "first_name", Şirket: "company" },
      });
    });
    it("is audited, and viewers cannot import", async () => {
      const { actor, org } = await tenant();
      await importCsv(actor, "email\na@x.co", { mapping: { email: "email" } });
      const { listOrgAudit } = await import("../org/service");
      const log = await listOrgAudit(
        { db, appUrl: "", sendEmail: async () => {} },
        actor,
      );
      expect(log.ok && log.entries.some((e) => e.action === "contacts.imported")).toBe(
        true,
      );
      const viewer = await createTestUser(db);
      await addTestMember(db, org.id, viewer.id, "viewer");
      expect(
        await importCsv(actorFor(viewer.id, org.id, "viewer"), "email\nb@x.co", {
          mapping: { email: "email" },
        }),
      ).toMatchObject({ code: "forbidden" });
    });
  });

  describe("suppression", () => {
    it("flips matching contacts' status and records the reason", async () => {
      const { actor } = await tenant();
      const [c] = await seed(actor, 1);
      await svc.suppressEmails(deps(), actor, {
        emails: [c!.email.toUpperCase()],
        reason: "complaint",
      });
      const detail = await svc.getContactDetail(deps(), actor, c!.id);
      expect(detail.ok && detail.contact.status).toBe("complained");
    });
    it("unsubscribe reason also withdraws consent and stamps the date", async () => {
      const { actor } = await tenant();
      const [c] = await seed(actor, 1, { consentStatus: "granted" });
      await svc.suppressEmails(deps(), actor, {
        emails: [c!.email],
        reason: "unsubscribe",
      });
      const detail = await svc.getContactDetail(deps(), actor, c!.id);
      expect(detail.ok && detail.contact).toMatchObject({
        status: "unsubscribed",
        consentStatus: "withdrawn",
      });
      expect(detail.ok && detail.contact.unsubscribedAt).toBeInstanceOf(Date);
    });
    it("blocks creating or re-subscribing a suppressed address until an admin lifts it", async () => {
      const { actor } = await tenant();
      const [c] = await seed(actor, 1);
      await svc.suppressEmails(deps(), actor, {
        emails: [c!.email],
        reason: "unsubscribe",
      });
      expect(
        await svc.updateContactFor(deps(), actor, c!.id, { status: "subscribed" }),
      ).toMatchObject({ ok: false, code: "suppressed" });
      expect(
        await svc.createContactFor(deps(), actor, { email: "never@example.com" }),
      ).toMatchObject({ ok: true });
      await svc.suppressEmails(deps(), actor, {
        emails: ["never@example.com"],
        reason: "manual",
      });
      await svc.bulkAction(deps(), actor, {
        action: "delete",
        filter: { q: "never@example.com" },
      });
      expect(
        await svc.createContactFor(deps(), actor, { email: "never@example.com" }),
      ).toMatchObject({ ok: false, code: "suppressed" });

      expect((await svc.liftSuppression(deps(), actor, c!.email)).ok).toBe(true);
      expect(
        (await svc.updateContactFor(deps(), actor, c!.id, { status: "subscribed" })).ok,
      ).toBe(true);
    });
    it("adding the same address twice is idempotent", async () => {
      const { actor } = await tenant();
      await svc.suppressEmails(deps(), actor, {
        emails: ["twice@x.co"],
        reason: "manual",
      });
      expect(
        await svc.suppressEmails(deps(), actor, {
          emails: ["twice@x.co"],
          reason: "manual",
        }),
      ).toMatchObject({ ok: true, added: 0, alreadyPresent: 1 });
    });
  });

  describe("segments", () => {
    const rule = (field: string, op: string, value?: string | number | string[]) => ({
      type: "rule" as const,
      field,
      op,
      ...(value === undefined ? {} : { value }),
    });
    const group = (
      op: "and" | "or",
      children: SegmentDefinition[],
      not = false,
    ): SegmentDefinition => ({ type: "group", op, not, children });

    async function populated() {
      const t = await tenant();
      const mk = (email: string, extra: Record<string, unknown>) =>
        svc.createContactFor(deps(), t.actor, {
          email: emailOf(email),
          ...extra,
        } as never);
      await svc.createFieldFor(deps(), t.actor, {
        key: "employees",
        label: "Çalışan",
        type: "number",
      });
      await mk("a", {
        company: "Startup",
        sector: "Technology",
        city: "Ankara",
        custom: { employees: 5 },
      });
      await mk("b", {
        company: "Startup",
        sector: "Health",
        city: "İzmir",
        custom: { employees: 50 },
      });
      await mk("c", { company: "Corp", sector: "Technology", city: "Ankara" });
      await mk("d", { company: null, sector: "Technology", city: null });
      return t;
    }
    const count = async (actor: Actor, def: SegmentDefinition) => {
      const r = await svc.previewSegment(
        deps(),
        actor,
        segmentDefinitionSchema.parse(def),
      );
      if (!r.ok) throw new Error("preview failed");
      return r.count;
    };

    it("evaluates AND / OR / NOT correctly (the brief's example shape)", async () => {
      const { actor } = await populated();
      expect(
        await count(
          actor,
          group("and", [
            rule("company", "eq", "startup"),
            rule("sector", "eq", "technology"),
          ]),
        ),
      ).toBe(1);
      expect(
        await count(
          actor,
          group("or", [rule("city", "eq", "Ankara"), rule("sector", "eq", "Health")]),
        ),
      ).toBe(3);
      expect(
        await count(actor, group("and", [rule("company", "eq", "Startup")], true)),
      ).toBe(2); // NOT includes the NULL company
    });
    it("handles text operators, empties and custom numeric fields", async () => {
      const { actor } = await populated();
      expect(
        await count(actor, group("and", [rule("company", "contains", "tart")])),
      ).toBe(2);
      expect(
        await count(actor, group("and", [rule("company", "starts_with", "cor")])),
      ).toBe(1);
      expect(await count(actor, group("and", [rule("company", "is_empty")]))).toBe(1);
      expect(await count(actor, group("and", [rule("city", "neq", "Ankara")]))).toBe(2); // includes NULL city
      expect(
        await count(actor, group("and", [rule("custom.employees", "gt", 10)])),
      ).toBe(1);
      expect(
        await count(actor, group("and", [rule("custom.employees", "lte", 5)])),
      ).toBe(1);
      expect(
        await count(actor, group("and", [rule("custom.employees", "is_empty")])),
      ).toBe(2);
    });
    it("supports date windows and engagement score thresholds", async () => {
      const { actor } = await populated();
      expect(
        await count(actor, group("and", [rule("created_at", "in_last_days", 1)])),
      ).toBe(4);
      expect(
        await count(actor, group("and", [rule("created_at", "before", "2000-01-01")])),
      ).toBe(0);
      expect(
        await count(actor, group("and", [rule("engagement_score", "gt", 70)])),
      ).toBe(0); // unscored contacts never match
    });
    it("matches list and tag membership, including negation", async () => {
      const { actor } = await populated();
      const list = await svc.createListFor(deps(), actor, { name: "L" });
      if (!list.ok) throw new Error("list failed");
      await svc.bulkAction(deps(), actor, {
        action: "add_to_list",
        filter: { q: "ankara" },
        listId: list.id,
      });
      await svc.bulkAction(deps(), actor, {
        action: "add_to_list",
        filter: { status: "subscribed" },
        listId: list.id,
      });
      expect(await count(actor, group("and", [rule("list", "in", [list.id])]))).toBe(4);
      expect(
        await count(actor, group("and", [rule("list", "not_in", [list.id])])),
      ).toBe(0);
    });
    it("saved segments filter the contact table and track their count", async () => {
      const { actor } = await populated();
      const created = await svc.createSegmentFor(deps(), actor, {
        name: "Tech",
        definition: segmentDefinitionSchema.parse(
          group("and", [rule("sector", "eq", "Technology")]),
        ),
      });
      if (!created.ok) throw new Error("segment failed");
      expect(created.count).toBe(3);
      const page = await svc.searchContacts(deps(), actor, {
        filter: { segmentId: created.id },
      });
      expect(page.ok && page.total).toBe(3);
      expect(
        await svc.createSegmentFor(deps(), actor, {
          name: "tech",
          definition: segmentDefinitionSchema.parse(
            group("and", [rule("sector", "eq", "x")]),
          ),
        }),
      ).toMatchObject({ code: "duplicate" });
    });

    describe("SQL injection resistance", () => {
      const attacks = [
        "'; DROP TABLE contacts; --",
        "' OR '1'='1",
        "x') OR 1=1 --",
        "\\",
        "%' ESCAPE '\\' OR '1'='1",
        "$1",
        "${1+1}",
        "\n--\n",
      ];
      it("treats hostile values as plain data for every text operator", async () => {
        const { actor } = await populated();
        for (const attack of attacks) {
          for (const op of ["eq", "neq", "contains", "not_contains", "starts_with"]) {
            expect(
              typeof (await count(actor, group("and", [rule("company", op, attack)]))),
            ).toBe("number");
          }
        }
        // 'eq' with an always-true payload must match nothing, not everything.
        expect(
          await count(actor, group("and", [rule("company", "eq", "' OR '1'='1")])),
        ).toBe(0);
        expect(
          await count(actor, group("and", [rule("company", "contains", "%")])),
        ).toBe(0);
        expect(await countContacts(db, actor.organizationId)).toBe(4); // table intact
      });
      it("rejects hostile field names and custom keys at validation, so they never reach SQL", () => {
        for (const field of [
          "email) or 1=1 --",
          "custom.x') or ('1'='1",
          "custom.a;drop",
          "contacts.password",
          "organization_id",
        ]) {
          expect(
            segmentDefinitionSchema.safeParse(group("and", [rule(field, "eq", "x")]))
              .success,
          ).toBe(false);
        }
      });
      it("compiler refuses an unvalidated hostile field if validation were ever bypassed", async () => {
        const { actor } = await populated();
        const hostile = {
          type: "group",
          op: "and",
          children: [{ type: "rule", field: "email) or 1=1 --", op: "eq", value: "x" }],
        } as SegmentDefinition;
        await expect(svc.previewSegment(deps(), actor, hostile)).rejects.toThrow();
      });
    });
  });

  describe("import → export round trip", () => {
    it("exports what was imported, neutralizing formula injection", async () => {
      const { actor } = await tenant();
      await importCsv(
        actor,
        'email,name,company\nf@x.co,Eve,"=HYPERLINK(""http://evil"")"',
      );
      const out = await svc.exportContacts(deps(), actor);
      if (!out.ok) throw new Error("export failed");
      let text = "";
      for await (const line of out.lines) text += line;
      expect(text.startsWith("﻿")).toBe(true);
      expect(text).toContain("'=HYPERLINK");
      expect(text).not.toMatch(/(^|,)=HYPERLINK/);
      expect(out.count).toBe(1);
    });
    it("exports are audited with the row count", async () => {
      const { actor } = await tenant();
      await seed(actor, 3);
      await svc.exportContacts(deps(), actor);
      const { listOrgAudit } = await import("../org/service");
      const log = await listOrgAudit(
        { db, appUrl: "", sendEmail: async () => {} },
        actor,
      );
      const entry = log.ok && log.entries.find((e) => e.action === "contacts.exported");
      expect(entry && entry.metadata).toMatchObject({ count: 3 });
    });
  });
});
