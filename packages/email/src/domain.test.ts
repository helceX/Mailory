import { describe, expect, it } from "vitest";
import {
  MockDnsResolver,
  buildDnsRecords,
  checkDns,
  type DnsRecord,
  type MockZone,
} from "./dns";
import {
  FAILING_GRACE_MS,
  PENDING_TIMEOUT_MS,
  nextDomainState,
  verifyDomain,
} from "./domain-verify";
import { MockDomainProvider, randomDkimToken } from "./provider";

const domain = "example.com";
const dkimTokens = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "cccccccccccccccccccccccccccccccc",
];
const ownershipToken = "0123456789abcdef0123456789abcdef";
const records = buildDnsRecords({ domain, dkimTokens, ownershipToken });
const rec = (key: string) => records.find((r) => r.key === key) as DnsRecord;

/** The zone a customer who followed our instructions exactly would have published. */
function perfectZone(): MockZone {
  const zone: MockZone = {};
  for (const r of records) {
    const entry = (zone[r.host] ??= {});
    if (r.type === "TXT") (entry.TXT ??= []).push(r.value);
    else (entry.CNAME ??= []).push(r.value);
  }
  zone[`_dmarc.${domain}`] = { TXT: ["v=DMARC1; p=quarantine;"] };
  return zone;
}
const verify = (zone: MockZone) => {
  const resolver = new MockDnsResolver(zone);
  return verifyDomain({
    domain,
    dkimTokens,
    ownershipToken,
    resolver,
    provider: new MockDomainProvider(resolver),
  });
};
const state = async (zone: MockZone, key: string) =>
  (await checkDns(new MockDnsResolver(zone), records)).find((r) => r.key === key)!;

describe("buildDnsRecords", () => {
  it("produces ownership, three DKIM CNAMEs, SPF and DMARC with correct hosts and required flags", () => {
    expect(records.map((r) => [r.key, r.required])).toEqual([
      ["ownership", true],
      ["dkim1", true],
      ["dkim2", true],
      ["dkim3", true],
      ["spf", false],
      ["dmarc", false],
    ]);
    expect(rec("ownership")).toMatchObject({
      type: "TXT",
      host: "_mailory-verification.example.com",
      hostShort: "_mailory-verification",
      value: `mailory-verification=${ownershipToken}`,
    });
    expect(rec("dkim1")).toMatchObject({
      type: "CNAME",
      host: `${dkimTokens[0]}._domainkey.example.com`,
      value: `${dkimTokens[0]}.dkim.amazonses.com`,
    });
    expect(rec("spf")).toMatchObject({ host: "example.com", hostShort: "@" });
    expect(rec("dmarc")).toMatchObject({
      host: "_dmarc.example.com",
      hostShort: "_dmarc",
    });
  });
  it("every record explains itself in plain language", () => {
    for (const r of records) expect(r.explain.length).toBeGreaterThan(30);
  });
});

describe("checkDns", () => {
  it("reports everything missing for an empty zone", async () => {
    const results = await checkDns(new MockDnsResolver({}), records);
    expect(results.map((r) => r.state)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
  });
  it("accepts a correctly published zone", async () => {
    const results = await checkDns(new MockDnsResolver(perfectZone()), records);
    expect(results.map((r) => r.state)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });
  it("tolerates quotes, case and trailing dots that DNS panels add", async () => {
    const zone = perfectZone();
    zone[rec("ownership").host] = { TXT: [`"${rec("ownership").value}"`] };
    zone[rec("dkim1").host] = {
      CNAME: [`${dkimTokens[0]!.toUpperCase()}.DKIM.AMAZONSES.COM.`],
    };
    expect((await state(zone, "ownership")).state).toBe("ok");
    expect((await state(zone, "dkim1")).state).toBe("ok");
  });
  it("flags a wrong ownership token or DKIM target as a mismatch (not missing)", async () => {
    const zone = perfectZone();
    zone[rec("ownership").host] = { TXT: ["mailory-verification=deadbeef"] };
    zone[rec("dkim2").host] = { CNAME: ["something.else.example.net"] };
    expect(await state(zone, "ownership")).toMatchObject({
      state: "mismatch",
      found: ["mailory-verification=deadbeef"],
    });
    expect((await state(zone, "dkim2")).state).toBe("mismatch");
  });

  describe("SPF", () => {
    const withSpf = (...values: string[]): MockZone => ({ [domain]: { TXT: values } });
    it("missing, ok, needs-include, and duplicate-record cases", async () => {
      expect((await state({}, "spf")).state).toBe("missing");
      expect(
        (await state(withSpf("v=spf1 include:amazonses.com ~all"), "spf")).state,
      ).toBe("ok");
      expect(
        (await state(withSpf("v=spf1 include:_spf.google.com ~all"), "spf")).state,
      ).toBe("warning");
      expect(
        (
          await state(
            withSpf(
              "v=spf1 include:amazonses.com ~all",
              "v=spf1 include:_spf.google.com ~all",
            ),
            "spf",
          )
        ).state,
      ).toBe("mismatch");
    });
    it("ignores unrelated TXT records at the apex", async () => {
      expect(
        (
          await state(
            withSpf(
              "google-site-verification=abc",
              "v=spf1 include:amazonses.com -all",
            ),
            "spf",
          )
        ).state,
      ).toBe("ok");
    });
    it("tells users to merge into an existing record rather than add a second", async () => {
      expect(
        (await state(withSpf("v=spf1 include:_spf.google.com ~all"), "spf")).message,
      ).toMatch(/ikinci/);
    });
  });

  describe("DMARC", () => {
    const withDmarc = (v: string): MockZone => ({ [`_dmarc.${domain}`]: { TXT: [v] } });
    it("missing, monitoring-only warning, enforcing ok, and malformed", async () => {
      expect((await state({}, "dmarc")).state).toBe("missing");
      expect(
        (await state(withDmarc("v=DMARC1; p=none; rua=mailto:a@example.com"), "dmarc"))
          .state,
      ).toBe("warning");
      expect(
        (await state(withDmarc("v=DMARC1; p=quarantine; pct=100"), "dmarc")).state,
      ).toBe("ok");
      expect((await state(withDmarc("v=DMARC1; p=reject"), "dmarc")).state).toBe("ok");
      expect(
        (await state(withDmarc("v=DMARC1; rua=mailto:a@example.com"), "dmarc")).state,
      ).toBe("mismatch");
    });
  });

  it("a lookup failure is state 'error', never 'missing'", async () => {
    const zone: MockZone = {
      [rec("ownership").host]: { FAIL: true },
      [rec("dkim1").host]: { FAIL: true },
    };
    expect((await state(zone, "ownership")).state).toBe("error");
    expect((await state(zone, "dkim1")).state).toBe("error");
  });
});

describe("verifyDomain", () => {
  it("verifies a fully published domain", async () => {
    const o = await verify(perfectZone());
    expect(o).toMatchObject({
      verified: true,
      ownershipOk: true,
      dkimOk: true,
      providerDkim: "success",
      inconclusive: false,
    });
  });
  it("verifies with only the REQUIRED records (SPF/DMARC are recommendations)", async () => {
    const zone = perfectZone();
    delete zone[domain];
    delete zone[`_dmarc.${domain}`];
    const o = await verify(zone);
    expect(o.verified).toBe(true);
    expect([o.spfState, o.dmarcState]).toEqual(["missing", "missing"]);
  });
  it("SECURITY: DKIM records alone (e.g. published by another workspace) do NOT verify without the ownership token", async () => {
    const zone = perfectZone();
    delete zone[rec("ownership").host];
    const o = await verify(zone);
    expect(o.dkimOk).toBe(true);
    expect(o.ownershipOk).toBe(false);
    expect(o.verified).toBe(false);
  });
  it("is not verified if any single DKIM record is missing", async () => {
    const zone = perfectZone();
    delete zone[rec("dkim3").host];
    const o = await verify(zone);
    expect(o).toMatchObject({
      verified: false,
      dkimOk: false,
      providerDkim: "pending",
    });
  });
  it("is INCONCLUSIVE (not failed) when a required lookup errors", async () => {
    const zone = perfectZone();
    zone[rec("dkim2").host] = { FAIL: true };
    const o = await verify(zone);
    expect(o).toMatchObject({ inconclusive: true, verified: false });
  });
  it("a flaky OPTIONAL lookup (SPF/DMARC) does not make the check inconclusive", async () => {
    const zone = perfectZone();
    zone[domain] = { FAIL: true };
    zone[`_dmarc.${domain}`] = { FAIL: true };
    const o = await verify(zone);
    expect(o).toMatchObject({ inconclusive: false, verified: true });
  });
  it("is inconclusive when the provider cannot be reached", async () => {
    const resolver = new MockDnsResolver(perfectZone());
    const broken = {
      name: "x",
      createIdentity: async () => ({ dkimTokens: [] }),
      getIdentityStatus: async () => {
        throw new Error("down");
      },
      deleteIdentity: async () => {},
    };
    const o = await verifyDomain({
      domain,
      dkimTokens,
      ownershipToken,
      resolver,
      provider: broken,
    });
    expect(o).toMatchObject({
      inconclusive: true,
      verified: false,
      providerDkim: "error",
    });
  });
});

describe("nextDomainState (fake clock)", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const ok = { verified: true, inconclusive: false };
  const bad = { verified: false, inconclusive: false };
  const unsure = { verified: false, inconclusive: true };

  it("pending → verified on success", () => {
    expect(
      nextDomainState(
        { status: "pending", createdAt: t0, failingSince: null },
        ok,
        at(1000),
      ),
    ).toMatchObject({ status: "verified", becameVerified: true });
  });
  it("an inconclusive check never changes anything", () => {
    for (const status of ["pending", "verified", "failed"] as const) {
      const next = nextDomainState(
        { status, createdAt: t0, failingSince: at(5) },
        unsure,
        at(PENDING_TIMEOUT_MS * 2),
      );
      expect(next).toMatchObject({
        status,
        becameFailed: false,
        becameVerified: false,
      });
      expect(next.failingSince).toEqual(at(5));
    }
  });
  it("a verified domain is NOT revoked on first failure; it gets a one-hour grace period", () => {
    const first = nextDomainState(
      { status: "verified", createdAt: t0, failingSince: null },
      bad,
      at(1000),
    );
    expect(first).toMatchObject({
      status: "verified",
      failingSince: at(1000),
      becameFailed: false,
    });
    const soon = nextDomainState(
      { status: "verified", createdAt: t0, failingSince: at(1000) },
      bad,
      at(1000 + FAILING_GRACE_MS - 1),
    );
    expect(soon.status).toBe("verified");
    const later = nextDomainState(
      { status: "verified", createdAt: t0, failingSince: at(1000) },
      bad,
      at(1000 + FAILING_GRACE_MS),
    );
    expect(later).toMatchObject({ status: "failed", becameFailed: true });
  });
  it("recovering within the grace period clears the failing marker", () => {
    expect(
      nextDomainState(
        { status: "verified", createdAt: t0, failingSince: at(1000) },
        ok,
        at(5000),
      ),
    ).toMatchObject({ status: "verified", failingSince: null, becameVerified: false });
  });
  it("a failed domain becomes verified again once fixed", () => {
    expect(
      nextDomainState(
        { status: "failed", createdAt: t0, failingSince: at(1) },
        ok,
        at(10),
      ),
    ).toMatchObject({ status: "verified", becameVerified: true, failingSince: null });
  });
  it("a never-verified domain times out to failed after 7 days, not before", () => {
    expect(
      nextDomainState(
        { status: "pending", createdAt: t0, failingSince: null },
        bad,
        at(PENDING_TIMEOUT_MS),
      ).status,
    ).toBe("pending");
    expect(
      nextDomainState(
        { status: "pending", createdAt: t0, failingSince: null },
        bad,
        at(PENDING_TIMEOUT_MS + 1),
      ),
    ).toMatchObject({ status: "failed", becameFailed: true });
  });
});

describe("MockDomainProvider", () => {
  it("issues three distinct 32-character base32 tokens", async () => {
    const { dkimTokens: t } = await new MockDomainProvider(
      new MockDnsResolver({}),
    ).createIdentity();
    expect(t).toHaveLength(3);
    expect(new Set(t).size).toBe(3);
    for (const token of t) expect(token).toMatch(/^[a-z2-7]{32}$/);
    expect(randomDkimToken()).not.toBe(randomDkimToken());
  });
  it("reports pending until all three CNAMEs exist, then success", async () => {
    const zone: MockZone = {};
    const provider = new MockDomainProvider(new MockDnsResolver(zone));
    expect((await provider.getIdentityStatus(domain, { dkimTokens })).dkim).toBe(
      "pending",
    );
    for (const t of dkimTokens)
      zone[`${t}._domainkey.${domain}`] = { CNAME: [`${t}.dkim.amazonses.com`] };
    expect((await provider.getIdentityStatus(domain, { dkimTokens })).dkim).toBe(
      "success",
    );
    expect((await provider.getIdentityStatus(domain, { dkimTokens: [] })).dkim).toBe(
      "not_started",
    );
  });
});
