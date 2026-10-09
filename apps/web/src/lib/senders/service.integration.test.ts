import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { asOrganizationId, createDb, senderDomains, type Database } from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import { sweepDomains } from "@mailory/deliverability";
import {
  MockDnsResolver,
  MockDomainProvider,
  buildDnsRecords,
  type DomainProvider,
  type MockZone,
} from "@mailory/email";
import type { OrgRole } from "@mailory/core";
import { listOrgAudit, type Actor } from "../org/service";
import * as svc from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const HOUR = 3_600_000;

suite("sender domains, identities and onboarding (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let zone: MockZone;
  let clock: Date;
  let deleted: string[];

  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  /** Fresh DNS, clock and provider per test; the clock only moves when a test moves it. */
  const deps = (): svc.SenderDeps => {
    const resolver = new MockDnsResolver(zone);
    const inner = new MockDomainProvider(resolver);
    const provider: DomainProvider = {
      name: inner.name,
      createIdentity: () => inner.createIdentity(),
      getIdentityStatus: (d, ctx) => inner.getIdentityStatus(d, ctx),
      deleteIdentity: async (d) => void deleted.push(d),
    };
    return { db, resolver, provider, platformHost: "app.mailory.io", now: () => clock };
  };
  const reset = () => {
    zone = {};
    clock = new Date("2026-03-01T10:00:00Z");
    deleted = [];
  };

  const actorFor = (userId: string, organizationId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(organizationId),
    role,
  });
  async function tenant() {
    reset();
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    return { user, org, actor: actorFor(user.id, org.id, "owner") };
  }
  async function memberOf(orgId: string, role: OrgRole) {
    const u = await createTestUser(db);
    await addTestMember(db, orgId, u.id, role);
    return actorFor(u.id, orgId, role);
  }
  const uniqueDomain = (prefix = "sirket") =>
    `${prefix}-${randomUUID().slice(0, 8)}.com`;

  async function addDomain(actor: Actor, domain = uniqueDomain()) {
    const r = await svc.addDomain(deps(), actor, domain);
    if (!r.ok) throw new Error(`addDomain failed: ${r.code}`);
    const detail = await svc.getDomainDetail(deps(), actor, r.id);
    if (!detail.ok) throw new Error("detail failed");
    return { id: r.id, domain: detail.domain.domain, records: detail.records };
  }
  /** What a customer who followed the instructions exactly would have published. */
  function publish(records: ReturnType<typeof buildDnsRecords>) {
    for (const r of records) {
      const entry = (zone[r.host] ??= {});
      if (r.type === "TXT") (entry.TXT ??= []).push(r.value);
      else (entry.CNAME ??= []).push(r.value);
    }
  }
  const unpublish = (records: ReturnType<typeof buildDnsRecords>) => {
    for (const r of records) delete zone[r.host];
  };
  const domainRow = async (id: string) =>
    (await db.select().from(senderDomains).where(eq(senderDomains.id, id)))[0]!;

  describe("adding a domain", () => {
    it("creates a pending domain with three DKIM tokens and a unique ownership token", async () => {
      const { actor } = await tenant();
      const { id, records } = await addDomain(
        actor,
        "  HTTPS://www.Örnek-Test.com/abc ".replace("Örnek", "ornek"),
      );
      const row = await domainRow(id);
      expect(row).toMatchObject({
        status: "pending",
        provider: "mock",
        ownershipOk: false,
        dkimOk: false,
      });
      expect(row.domain).toMatch(/^ornek-test\.com$/);
      expect(row.dkimTokens).toHaveLength(3);
      expect(row.ownershipToken).toMatch(/^[0-9a-f]{32}$/);
      expect(records).toHaveLength(6);
    });
    it("rejects malformed names, free-mail providers, and the platform's own domain (and subdomains)", async () => {
      const { actor } = await tenant();
      expect(await svc.addDomain(deps(), actor, "not a domain")).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect(await svc.addDomain(deps(), actor, "gmail.com")).toMatchObject({
        ok: false,
        code: "free_mail",
      });
      expect(await svc.addDomain(deps(), actor, "Outlook.com")).toMatchObject({
        ok: false,
        code: "free_mail",
      });
      expect(await svc.addDomain(deps(), actor, "mailory.io")).toMatchObject({
        ok: false,
        code: "platform_domain",
      });
      expect(await svc.addDomain(deps(), actor, "news.mailory.io")).toMatchObject({
        ok: false,
        code: "platform_domain",
      });
    });
    it("a look-alike of the platform domain is allowed (it is not the platform domain)", async () => {
      const { actor } = await tenant();
      expect((await svc.addDomain(deps(), actor, "evilmailory.io")).ok).toBe(true);
    });
    it("the same domain cannot be added twice in one organization", async () => {
      const { actor } = await tenant();
      const domain = uniqueDomain();
      await addDomain(actor, domain);
      expect(await svc.addDomain(deps(), actor, domain.toUpperCase())).toMatchObject({
        ok: false,
        code: "duplicate",
      });
    });
    it("two organizations may both CLAIM a domain (only verification is exclusive)", async () => {
      const a = await tenant();
      const b = await tenant();
      const domain = uniqueDomain();
      expect((await svc.addDomain(deps(), a.actor, domain)).ok).toBe(true);
      expect((await svc.addDomain(deps(), b.actor, domain)).ok).toBe(true);
    });
    it("a provider failure is reported cleanly and leaves nothing behind", async () => {
      const { actor } = await tenant();
      const broken = {
        ...deps(),
        provider: {
          name: "x",
          createIdentity: async () => {
            throw new Error("SES down");
          },
          getIdentityStatus: async () => ({ dkim: "pending" as const }),
          deleteIdentity: async () => {},
        },
      };
      const domain = uniqueDomain();
      expect(await svc.addDomain(broken, actor, domain)).toMatchObject({
        ok: false,
        code: "provider_error",
      });
      const list = await svc.listDomains(deps(), actor);
      expect(list.ok && list.domains).toHaveLength(0);
    });
  });

  describe("authorization", () => {
    it("only admins and owners manage domains and identities; editors and viewers may only look", async () => {
      const { actor, org } = await tenant();
      const { id } = await addDomain(actor);
      const editor = await memberOf(org.id, "editor");
      const viewer = await memberOf(org.id, "viewer");
      for (const who of [editor, viewer]) {
        expect(await svc.addDomain(deps(), who, uniqueDomain())).toMatchObject({
          code: "forbidden",
        });
        expect(await svc.checkDomainNow(deps(), who, id)).toMatchObject({
          code: "forbidden",
        });
        expect(await svc.removeDomain(deps(), who, id)).toMatchObject({
          code: "forbidden",
        });
        expect(await svc.getDomainDetail(deps(), who, id)).toMatchObject({
          code: "forbidden",
        });
        expect(
          await svc.createIdentity(deps(), who, {
            fromName: "A",
            fromEmail: "a@ornek.com",
            replyTo: null,
          }),
        ).toMatchObject({ code: "forbidden" });
        expect((await svc.listDomains(deps(), who)).ok).toBe(true);
        expect((await svc.listIdentities(deps(), who)).ok).toBe(true);
      }
      const admin = await memberOf(org.id, "admin");
      expect((await svc.getDomainDetail(deps(), admin, id)).ok).toBe(true);
    });
  });

  describe("verification lifecycle", () => {
    it("stays pending until the customer publishes DNS, then verifies and is audited", async () => {
      const { actor } = await tenant();
      const { id, records } = await addDomain(actor);
      const before = await svc.checkDomainNow(deps(), actor, id);
      expect(before.ok && before.result).toMatchObject({
        status: "pending",
        becameVerified: false,
      });
      expect(
        before.ok && before.result.outcome.results.filter((r) => r.state === "missing"),
      ).toHaveLength(6);

      publish(records);
      zone[`_dmarc.${(await domainRow(id)).domain}`] = {
        TXT: ["v=DMARC1; p=quarantine;"],
      };
      const after = await svc.checkDomainNow(deps(), actor, id);
      expect(after.ok && after.result).toMatchObject({
        status: "verified",
        becameVerified: true,
      });
      const row = await domainRow(id);
      expect(row).toMatchObject({
        status: "verified",
        ownershipOk: true,
        dkimOk: true,
        spfState: "ok",
        dmarcState: "ok",
      });
      expect(row.verifiedAt).toBeInstanceOf(Date);

      const log = await listOrgAudit(
        { db, appUrl: "", sendEmail: async () => {} },
        actor,
      );
      expect(log.ok && log.entries.map((e) => e.action)).toEqual(
        expect.arrayContaining(["sender_domain.added", "sender_domain.verified"]),
      );
    });
    it("per-record results tell the customer what is wrong", async () => {
      const { actor } = await tenant();
      const { id, records } = await addDomain(actor);
      publish(records.filter((r) => r.key !== "dkim2"));
      const r = await svc.checkDomainNow(deps(), actor, id);
      if (!r.ok) throw new Error("check failed");
      const byKey = Object.fromEntries(
        r.result.outcome.results.map((x) => [x.key, x.state]),
      );
      expect(byKey).toMatchObject({
        ownership: "ok",
        dkim1: "ok",
        dkim2: "missing",
        dkim3: "ok",
        spf: "ok",
      });
      expect(r.result.status).toBe("pending");
    });
    it("a verified domain survives a DNS blip, and only fails after an hour of continuous failure", async () => {
      const { actor } = await tenant();
      const { id, records } = await addDomain(actor);
      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      expect((await domainRow(id)).status).toBe("verified");

      unpublish(records);
      clock = new Date(clock.getTime() + 5 * 60_000);
      const first = await svc.checkDomainNow(deps(), actor, id);
      expect(first.ok && first.result).toMatchObject({
        status: "verified",
        becameFailed: false,
      });
      expect((await domainRow(id)).failingSince).toBeInstanceOf(Date);

      clock = new Date(clock.getTime() + 30 * 60_000);
      expect(
        (await svc.checkDomainNow(deps(), actor, id)).ok &&
          (await domainRow(id)).status,
      ).toBe("verified");

      clock = new Date(clock.getTime() + 31 * 60_000);
      const failed = await svc.checkDomainNow(deps(), actor, id);
      expect(failed.ok && failed.result).toMatchObject({
        status: "failed",
        becameFailed: true,
      });

      publish(records);
      const back = await svc.checkDomainNow(deps(), actor, id);
      expect(back.ok && back.result).toMatchObject({
        status: "verified",
        becameVerified: true,
      });
      expect((await domainRow(id)).failingSince).toBeNull();
    });
    it("recovering inside the grace period clears the warning without ever failing", async () => {
      const { actor } = await tenant();
      const { id, records } = await addDomain(actor);
      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      unpublish(records);
      clock = new Date(clock.getTime() + 60_000);
      await svc.checkDomainNow(deps(), actor, id);
      publish(records);
      clock = new Date(clock.getTime() + 60_000);
      const ok = await svc.checkDomainNow(deps(), actor, id);
      expect(ok.ok && ok.result.becameFailed).toBe(false);
      expect(await domainRow(id)).toMatchObject({
        status: "verified",
        failingSince: null,
      });
    });
    it("a DNS LOOKUP FAILURE never changes status (verified stays verified)", async () => {
      const { actor } = await tenant();
      const { id, records } = await addDomain(actor);
      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      zone[records[0]!.host] = { FAIL: true };
      clock = new Date(clock.getTime() + 5 * HOUR);
      const r = await svc.checkDomainNow(deps(), actor, id);
      expect(r.ok && r.result.outcome.inconclusive).toBe(true);
      expect(await domainRow(id)).toMatchObject({
        status: "verified",
        failingSince: null,
        lastError: "lookup_failed",
      });
    });
    it("a never-verified domain times out to failed after 7 days", async () => {
      const { actor } = await tenant();
      const { id } = await addDomain(actor);
      // created_at comes from the database's real clock, so measure the 7 days from real "now".
      clock = new Date(Date.now() + 8 * 24 * HOUR);
      const r = await svc.checkDomainNow(deps(), actor, id);
      expect(r.ok && r.result).toMatchObject({ status: "failed", becameFailed: true });
    });
  });

  describe("domain ownership across workspaces (hijack resistance)", () => {
    it("workspace B cannot verify a domain A already verified by copying DKIM records: it needs B's own ownership token", async () => {
      const a = await tenant();
      const b = await tenant();
      const domain = uniqueDomain();
      const aDomain = await addDomain(a.actor, domain);
      publish(aDomain.records);
      await svc.checkDomainNow(deps(), a.actor, aDomain.id);
      expect((await domainRow(aDomain.id)).status).toBe("verified");

      const bDomain = await addDomain(b.actor, domain);
      // A's records are in DNS (including A's ownership token) — but not B's.
      const attempt = await svc.checkDomainNow(deps(), b.actor, bDomain.id);
      expect(attempt.ok && attempt.result).toMatchObject({
        status: "pending",
        becameVerified: false,
      });
      expect((await domainRow(bDomain.id)).ownershipOk).toBe(false);
    });
    it("even a fully published second claim cannot displace the verified holder: it stays pending and says why", async () => {
      const a = await tenant();
      const b = await tenant();
      const domain = uniqueDomain();
      const aDomain = await addDomain(a.actor, domain);
      publish(aDomain.records);
      await svc.checkDomainNow(deps(), a.actor, aDomain.id);

      const bDomain = await addDomain(b.actor, domain);
      publish(bDomain.records); // the genuine owner published both workspaces' records
      const result = await svc.checkDomainNow(deps(), b.actor, bDomain.id);
      expect(result.ok && result.result).toMatchObject({
        status: "pending",
        claimedElsewhere: true,
        becameVerified: false,
      });
      expect(await domainRow(bDomain.id)).toMatchObject({
        status: "pending",
        lastError: "claimed_elsewhere",
      });
      expect((await domainRow(aDomain.id)).status).toBe("verified");
    });
    it("a second workspace may verify once the holder removes the domain", async () => {
      const a = await tenant();
      const b = await tenant();
      const domain = uniqueDomain();
      const aDomain = await addDomain(a.actor, domain);
      publish(aDomain.records);
      await svc.checkDomainNow(deps(), a.actor, aDomain.id);
      const bDomain = await addDomain(b.actor, domain);
      publish(bDomain.records);
      await svc.removeDomain(deps(), a.actor, aDomain.id);
      const result = await svc.checkDomainNow(deps(), b.actor, bDomain.id);
      expect(result.ok && result.result).toMatchObject({
        status: "verified",
        becameVerified: true,
      });
    });
  });

  describe("removal", () => {
    it("tears down the provider identity only when no other workspace claims the domain", async () => {
      const a = await tenant();
      const b = await tenant();
      const shared = uniqueDomain();
      const solo = uniqueDomain();
      const aShared = await addDomain(a.actor, shared);
      await addDomain(b.actor, shared);
      const aSolo = await addDomain(a.actor, solo);

      await svc.removeDomain(deps(), a.actor, aShared.id);
      expect(deleted).not.toContain(shared);
      await svc.removeDomain(deps(), a.actor, aSolo.id);
      expect(deleted).toContain(solo);
    });
  });

  describe("identities", () => {
    const input = (email: string, name = "Acme") => ({
      fromName: name,
      fromEmail: email,
      replyTo: null,
    });

    it("the first identity becomes the default; later ones do not", async () => {
      const { actor } = await tenant();
      await svc.createIdentity(deps(), actor, input("a@ornek.com"));
      await svc.createIdentity(deps(), actor, input("b@ornek.com"));
      const list = await svc.listIdentities(deps(), actor);
      expect(list.ok && list.identities.map((i) => [i.fromEmail, i.isDefault])).toEqual(
        [
          ["a@ornek.com", true],
          ["b@ornek.com", false],
        ],
      );
    });
    it("rejects free-mail and platform-domain From addresses and duplicates", async () => {
      const { actor } = await tenant();
      expect(
        await svc.createIdentity(deps(), actor, input("me@gmail.com")),
      ).toMatchObject({ ok: false, code: "free_mail" });
      expect(
        await svc.createIdentity(deps(), actor, input("x@mailory.io")),
      ).toMatchObject({ ok: false, code: "platform_domain" });
      await svc.createIdentity(deps(), actor, input("a@ornek.com"));
      expect(
        await svc.createIdentity(deps(), actor, input("A@ORNEK.com")),
      ).toMatchObject({ ok: false, code: "duplicate" });
    });
    it("is unusable until its domain verifies, usable after, and unusable again if the domain is removed", async () => {
      const { actor } = await tenant();
      const { id, domain, records } = await addDomain(actor);
      await svc.createIdentity(deps(), actor, input(`info@${domain}`));
      const usable = async () => {
        const l = await svc.listIdentities(deps(), actor);
        return l.ok ? l.identities[0]! : null;
      };
      expect(await usable()).toMatchObject({
        usable: false,
        domain: { status: "pending" },
      });

      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      expect(await usable()).toMatchObject({
        usable: true,
        domain: { status: "verified" },
      });

      await svc.removeDomain(deps(), actor, id);
      expect(await usable()).toMatchObject({ usable: false, domain: null });
    });
    it("a verified domain covers its subdomains but never look-alikes", async () => {
      const { actor } = await tenant();
      const { id, domain, records } = await addDomain(actor);
      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      await svc.createIdentity(deps(), actor, input(`news@mail.${domain}`));
      await svc.createIdentity(deps(), actor, input(`x@not${domain}`));
      const list = await svc.listIdentities(deps(), actor);
      const byEmail = Object.fromEntries(
        (list.ok ? list.identities : []).map((i) => [i.fromEmail, i.usable]),
      );
      expect(byEmail[`news@mail.${domain}`]).toBe(true);
      expect(byEmail[`x@not${domain}`]).toBe(false);
    });
    it("changing the default always leaves exactly one; deleting the default promotes another", async () => {
      const { actor } = await tenant();
      const a = await svc.createIdentity(deps(), actor, input("a@ornek.com"));
      const b = await svc.createIdentity(deps(), actor, input("b@ornek.com"));
      if (!a.ok || !b.ok) throw new Error("setup failed");
      await svc.makeDefaultIdentity(deps(), actor, b.id);
      let list = await svc.listIdentities(deps(), actor);
      expect(
        list.ok && list.identities.filter((i) => i.isDefault).map((i) => i.fromEmail),
      ).toEqual(["b@ornek.com"]);
      await svc.removeIdentity(deps(), actor, b.id);
      list = await svc.listIdentities(deps(), actor);
      expect(list.ok && list.identities.map((i) => [i.fromEmail, i.isDefault])).toEqual(
        [["a@ornek.com", true]],
      );
    });
    it("updates name, address and reply-to", async () => {
      const { actor } = await tenant();
      const a = await svc.createIdentity(deps(), actor, input("a@ornek.com"));
      if (!a.ok) throw new Error("setup failed");
      expect(
        (
          await svc.updateIdentity(deps(), actor, a.id, {
            fromName: "Yeni Ad",
            fromEmail: "yeni@ornek.com",
            replyTo: "destek@ornek.com",
          })
        ).ok,
      ).toBe(true);
      const list = await svc.listIdentities(deps(), actor);
      expect(list.ok && list.identities[0]).toMatchObject({
        fromName: "Yeni Ad",
        fromEmail: "yeni@ornek.com",
        replyTo: "destek@ornek.com",
      });
    });
  });

  describe("tenant isolation (cross-tenant / IDOR)", () => {
    it("never reads, checks, removes or lists another workspace's domains and identities", async () => {
      reset();
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const bDomain = await addDomain(b);
      const bIdentity = await svc.createIdentity(deps(), b, {
        fromName: "B",
        fromEmail: "b@ornek.com",
        replyTo: null,
      });
      if (!bIdentity.ok) throw new Error("setup failed");

      expect(await svc.getDomainDetail(deps(), a, bDomain.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await svc.checkDomainNow(deps(), a, bDomain.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await svc.removeDomain(deps(), a, bDomain.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(
        await svc.updateIdentity(deps(), a, bIdentity.id, {
          fromName: "hijack",
          fromEmail: "h@ornek.com",
          replyTo: null,
        }),
      ).toMatchObject({ ok: false, code: "not_found" });
      expect(await svc.makeDefaultIdentity(deps(), a, bIdentity.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      expect(await svc.removeIdentity(deps(), a, bIdentity.id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
      const domains = await svc.listDomains(deps(), a);
      const idents = await svc.listIdentities(deps(), a);
      expect(domains.ok && domains.domains).toHaveLength(0);
      expect(idents.ok && idents.identities).toHaveLength(0);
      expect((await domainRow(bDomain.id)).status).toBe("pending");
    });
    it("another workspace's VERIFIED domain does not make my identity usable", async () => {
      reset();
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const a = actorFor(ownerA.id, orgA.id, "owner");
      const b = actorFor(ownerB.id, orgB.id, "owner");
      const bDomain = await addDomain(b);
      publish(bDomain.records);
      await svc.checkDomainNow(deps(), b, bDomain.id);
      await svc.createIdentity(deps(), a, {
        fromName: "A",
        fromEmail: `a@${bDomain.domain}`,
        replyTo: null,
      });
      const list = await svc.listIdentities(deps(), a);
      expect(list.ok && list.identities[0]).toMatchObject({
        usable: false,
        domain: null,
      });
    });
  });

  describe("onboarding checklist", () => {
    it("starts with only the organization step and reflects real progress", async () => {
      const { actor } = await tenant();
      const start = await svc.getOnboarding({ db }, actor);
      expect(start).toMatchObject({ completed: 1, total: 7, finished: false });
      expect(start.steps.filter((s) => s.done).map((s) => s.key)).toEqual([
        "organization",
      ]);

      await svc.createIdentity(deps(), actor, {
        fromName: "A",
        fromEmail: "a@ornek.com",
        replyTo: null,
      });
      const { id, records } = await addDomain(actor);
      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      const mid = await svc.getOnboarding({ db }, actor);
      expect(mid.steps.filter((s) => s.done).map((s) => s.key)).toEqual(
        expect.arrayContaining(["organization", "sender", "domain"]),
      );

      await svc.removeDomain(deps(), actor, id);
      const after = await svc.getOnboarding({ db }, actor);
      expect(after.steps.find((s) => s.key === "domain")!.done).toBe(false); // derived live, so it can never go stale
    });
    it("only counts this organization's data", async () => {
      reset();
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      await svc.createIdentity(deps(), actorFor(ownerB.id, orgB.id, "owner"), {
        fromName: "B",
        fromEmail: "b@ornek.com",
        replyTo: null,
      });
      const a = await svc.getOnboarding({ db }, actorFor(ownerA.id, orgA.id, "owner"));
      expect(a.steps.find((s) => s.key === "sender")!.done).toBe(false);
    });
  });

  describe("background sweep", () => {
    const sweepDeps = () => {
      const d = deps();
      return { db, resolver: d.resolver, provider: d.provider, now: d.now };
    };
    // Scoped to one organization so the result never depends on other tests' leftover domains.
    let scope: { limit: number; organizationId: string };
    it("checks due domains, verifies ones whose DNS appeared, and respects each status's interval", async () => {
      const { actor, org } = await tenant();
      scope = { limit: 500, organizationId: org.id };
      const { id, records } = await addDomain(actor);

      // Never checked → due.
      const first = await sweepDomains(sweepDeps(), scope);
      expect(first.checked).toBe(1);
      expect((await domainRow(id)).lastCheckedAt).toEqual(clock);

      // Immediately again → not due (pending interval is 10 minutes).
      publish(records);
      clock = new Date(clock.getTime() + 2 * 60_000);
      await sweepDomains(sweepDeps(), scope);
      expect((await domainRow(id)).status).toBe("pending");

      // After 10 minutes → due, and now verifies.
      clock = new Date(clock.getTime() + 9 * 60_000);
      const third = await sweepDomains(sweepDeps(), scope);
      expect(third.verified).toBeGreaterThanOrEqual(1);
      expect((await domainRow(id)).status).toBe("verified");

      // Verified + healthy → not due for 24h.
      const checkedAt = (await domainRow(id)).lastCheckedAt;
      clock = new Date(clock.getTime() + 2 * HOUR);
      await sweepDomains(sweepDeps(), scope);
      expect((await domainRow(id)).lastCheckedAt).toEqual(checkedAt);
      clock = new Date(clock.getTime() + 23 * HOUR);
      await sweepDomains(sweepDeps(), scope);
      expect((await domainRow(id)).lastCheckedAt).toEqual(clock);
    });
    it("a lookup failure during the sweep is counted as inconclusive and never revokes verification", async () => {
      const { actor, org } = await tenant();
      scope = { limit: 500, organizationId: org.id };
      const { id, records } = await addDomain(actor);
      publish(records);
      await svc.checkDomainNow(deps(), actor, id);
      zone[records[1]!.host] = { FAIL: true };
      clock = new Date(clock.getTime() + 25 * HOUR);
      const summary = await sweepDomains(sweepDeps(), scope);
      expect(summary).toMatchObject({ checked: 1, inconclusive: 1 });
      expect((await domainRow(id)).status).toBe("verified");
    });
  });
});
