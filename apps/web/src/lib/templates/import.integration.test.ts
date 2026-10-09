import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { asOrganizationId, assets, createDb, type Database } from "@mailory/db";
import { addTestMember, createTestOrg, createTestUser } from "@mailory/db/testing";
import { docHasUnsubscribe, type OrgRole } from "@mailory/core";
import { buildMergeValues, renderEmail } from "@mailory/email";
import type { Actor } from "../org/service";
import { importHtmlTemplateFor } from "./import";
import { getTemplateFor } from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const APP = "https://app.test";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const page = (inner: string, extra = "") =>
  `<!DOCTYPE html><html><head><title>T</title><style>.w{width:600px} @media (max-width:600px){.w{width:100%}}</style>${extra}</head><body bgcolor="#eeeeee">${inner}</body></html>`;

suite("HTML template import (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());
  const deps = () => ({ db, appUrl: APP });

  async function actorFor(role: OrgRole = "owner", orgId?: string): Promise<Actor> {
    const u = await createTestUser(db);
    const org = orgId ? { id: orgId } : await createTestOrg(db, u.id);
    if (orgId || role !== "owner") await addTestMember(db, org.id, u.id, role);
    return { userId: u.id, organizationId: asOrganizationId(org.id), role };
  }
  const name = () => `Envato ${randomUUID().slice(0, 6)}`;

  it("imports a ZIP: uploads local images, translates tags, adds unsubscribe, strips scripts", async () => {
    const actor = await actorFor();
    const html = page(
      `<table class="w"><tr><td><img src="images/logo.png" alt=""><h1>Merhaba *|FNAME|*</h1><script>alert(1)</script><a href="https://shop.test/x">Git</a><img src="images/missing.png"></td></tr></table>`,
    );
    const zip = zipSync({
      "pack/index.html": strToU8(html),
      "pack/images/logo.png": new Uint8Array(PNG),
      "__MACOSX/pack/._index.html": strToU8("x"),
    });
    const r = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "newsletter",
      filename: "t.zip",
      bytes: Buffer.from(zip),
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("id" in r)) throw new Error("no id");
    const got = await getTemplateFor(deps(), actor, r.id);
    if (!got.ok) throw new Error("get failed");
    const raw = got.doc.raw!;
    expect(got.doc.blocks).toEqual([]);
    expect(raw.html).toMatch(/src="\/a\/[0-9a-f-]{36}"/);
    expect(raw.html).toContain("Merhaba {{first_name}}");
    expect(raw.html).not.toMatch(/script|alert/);
    expect(raw.html).not.toContain("missing.png");
    expect(raw.css).toContain("@media");
    expect(docHasUnsubscribe(got.doc)).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/abonelikten çık/);
    expect(r.warnings.join(" ")).toMatch(/1 görsel Mailory'ye yüklendi/);
    const id = /\/a\/([0-9a-f-]{36})/.exec(raw.html)![1]!;
    const [asset] = await db.select().from(assets).where(eq(assets.id, id));
    expect(asset?.organizationId).toBe(actor.organizationId);

    // …and it renders and sends like any other template.
    const out = renderEmail(got.doc, {
      appUrl: APP,
      values: buildMergeValues(
        { firstName: "Ayşe", email: "a@b.co" },
        {
          unsubscribeUrl: "https://app.test/u/x",
          viewInBrowserUrl: "https://app.test/v/x",
          orgName: "Acme",
        },
      ),
    });
    expect(out.html).toContain("Merhaba Ayşe");
    expect(out.html).toContain(`${APP}/a/${id}`);
    expect(out.html).toContain('href="https://app.test/u/x"');
  });

  it("a single HTML file works; its relative images are dropped with a hint", async () => {
    const actor = await actorFor();
    const r = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "mail.html",
      bytes: Buffer.from(
        page(`<p>Selam</p><img src="logo.png"><a href="{{unsubscribe_url}}">çık</a>`),
      ),
    });
    expect(r.ok && "warnings" in r && r.warnings.join(" ")).toMatch(
      /ZIP olarak yükleyin/,
    );
    expect(r.ok && "warnings" in r && r.warnings.join(" ")).not.toMatch(
      /standart bir bağlantı eklendi/,
    );
  });

  it("asks which layout to use when an archive has several, and honours the choice", async () => {
    const actor = await actorFor();
    const zip = Buffer.from(
      zipSync({
        "a/layout-1.html": strToU8(page("<p>Bir</p>")),
        "a/layout-2.html": strToU8(page("<p>İki</p>")),
      }),
    );
    const first = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "p.zip",
      bytes: zip,
    });
    expect(first).toMatchObject({
      ok: true,
      choices: ["a/layout-1.html", "a/layout-2.html"],
    });
    const second = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "p.zip",
      bytes: zip,
      entry: "a/layout-2.html",
    });
    if (!second.ok || !("id" in second)) throw new Error("import failed");
    const got = await getTemplateFor(deps(), actor, second.id);
    expect(got.ok && got.doc.raw?.html).toContain("İki");
  });

  it("refuses archives that are too big or contain too many files, and never reads outside the archive", async () => {
    const actor = await actorFor();
    const many: Record<string, Uint8Array> = {
      "index.html": strToU8(page("<p>x</p>")),
    };
    for (let i = 0; i < 520; i++) many[`img/${i}.png`] = new Uint8Array(PNG);
    const tooMany = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "x.zip",
      bytes: Buffer.from(zipSync(many)),
    });
    expect(tooMany).toMatchObject({ ok: false, code: "too_large" });

    const traversal = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "x.zip",
      bytes: Buffer.from(
        zipSync({
          "index.html": strToU8(
            page(
              `<img src="../../etc/passwd.png"><img src="../secret.png"><a href="{{unsubscribe_url}}">u</a>`,
            ),
          ),
          "secret.png": new Uint8Array(PNG),
        }),
      ),
    });
    expect(
      traversal.ok && "warnings" in traversal && traversal.warnings.join(" "),
    ).toMatch(/atlandı/);

    const notZip = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "x.zip",
      bytes: Buffer.from("PK\x03\x04garbage"),
    });
    expect(notZip).toMatchObject({ ok: false, code: "invalid" });
    const wrongType = await importHtmlTemplateFor(deps(), actor, {
      name: name(),
      category: "other",
      filename: "x.exe",
      bytes: Buffer.from("MZ"),
    });
    expect(wrongType).toMatchObject({ ok: false, code: "invalid" });
  });

  it("only editors and above can import; duplicate names are refused; assets stay in the tenant", async () => {
    const owner = await actorFor();
    const viewer = await actorFor("viewer", owner.organizationId);
    const body = Buffer.from(page(`<p>x</p><a href="{{unsubscribe_url}}">u</a>`));
    expect(
      await importHtmlTemplateFor(deps(), viewer, {
        name: name(),
        category: "other",
        filename: "a.html",
        bytes: body,
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const n = name();
    expect(
      (
        await importHtmlTemplateFor(deps(), owner, {
          name: n,
          category: "other",
          filename: "a.html",
          bytes: body,
        })
      ).ok,
    ).toBe(true);
    expect(
      await importHtmlTemplateFor(deps(), owner, {
        name: n,
        category: "other",
        filename: "a.html",
        bytes: body,
      }),
    ).toMatchObject({ ok: false, code: "duplicate" });
  });
});
