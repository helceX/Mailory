import { describe, expect, it } from "vitest";
import { analyzeDomainHealth, type DomainHealthInput } from "./domain-health";

const good: DomainHealthInput = {
  domain: "ornek.com",
  txt: [
    "google-site-verification=abc",
    "v=spf1 include:_spf.google.com include:amazonses.com ~all",
  ],
  dmarc: ["v=DMARC1; p=quarantine; rua=mailto:dmarc@ornek.com"],
  dkimSelectors: ["google"],
  mx: ["aspmx.l.google.com"],
};
const codes = (i: Partial<DomainHealthInput>) =>
  analyzeDomainHealth({ ...good, ...i }).findings.map((f) => f.code);

describe("domain health analysis", () => {
  it("a properly configured domain is good and has no findings", () => {
    const r = analyzeDomainHealth(good);
    expect(r.findings).toEqual([]);
    expect(r).toMatchObject({ score: 100, band: "good", incomplete: false });
    expect(r.facts.spf).toContain("v=spf1");
  });

  describe("SPF", () => {
    it("missing → critical", () => {
      const r = analyzeDomainHealth({ ...good, txt: [] });
      expect(r.findings[0]).toMatchObject({
        code: "spf_missing",
        severity: "critical",
      });
      expect(r.facts.spf).toBeNull();
    });
    it("two SPF records are invalid", () => {
      expect(codes({ txt: ["v=spf1 -all", "v=spf1 include:a.com ~all"] })).toContain(
        "spf_multiple",
      );
    });
    it("counts DNS-lookup mechanisms: >10 is critical, 8-10 an early warning, fewer is fine", () => {
      const inc = (n: number) =>
        `v=spf1 ${Array.from({ length: n }, (_, i) => `include:s${i}.example.com`).join(" ")} ~all`;
      expect(codes({ txt: [inc(11)] })).toContain("spf_lookups");
      expect(codes({ txt: [inc(10)] })).toContain("spf_lookups_near");
      expect(codes({ txt: [inc(3)] })).toEqual([]);
      expect(
        codes({ txt: ["v=spf1 a mx include:x.com redirect=y.com ~all"] }),
      ).not.toContain("spf_lookups");
    });
    it("ip4/ip6 mechanisms do not count as lookups", () => {
      const many = `v=spf1 ${Array.from({ length: 15 }, (_, i) => `ip4:10.0.0.${i}`).join(" ")} -all`;
      expect(codes({ txt: [many] })).toEqual([]);
    });
    it("+all and ?all are flagged; ~all and -all are fine; no all is a warning; ptr is discouraged", () => {
      expect(codes({ txt: ["v=spf1 include:a.com +all"] })).toContain("spf_plus_all");
      expect(codes({ txt: ["v=spf1 include:a.com all"] })).toContain("spf_plus_all");
      expect(codes({ txt: ["v=spf1 include:a.com ?all"] })).toContain("spf_neutral");
      expect(codes({ txt: ["v=spf1 include:a.com -all"] })).toEqual([]);
      expect(codes({ txt: ["v=spf1 include:a.com"] })).toContain("spf_no_all");
      expect(codes({ txt: ["v=spf1 ptr ~all"] })).toContain("spf_ptr");
    });
    it("matches v=spf1 case-insensitively and ignores unrelated TXT", () => {
      expect(codes({ txt: ["V=SPF1 include:a.com ~all", "not-spf"] })).toEqual([]);
    });
  });

  describe("DMARC", () => {
    it("missing → critical with the Gmail/Yahoo explanation", () => {
      const f = analyzeDomainHealth({ ...good, dmarc: [] }).findings[0]!;
      expect(f).toMatchObject({ code: "dmarc_missing", severity: "critical" });
      expect(f.message).toMatch(/Gmail/);
    });
    it("p=none is a warning, quarantine/reject are fine", () => {
      expect(codes({ dmarc: ["v=DMARC1; p=none; rua=mailto:a@b.com"] })).toEqual([
        "dmarc_monitor_only",
      ]);
      expect(codes({ dmarc: ["v=DMARC1; p=reject; rua=mailto:a@b.com"] })).toEqual([]);
    });
    it("invalid policy is critical; no rua and partial pct are informational", () => {
      expect(codes({ dmarc: ["v=DMARC1; p=banana"] })).toContain("dmarc_bad_policy");
      expect(codes({ dmarc: ["v=DMARC1; p=reject"] })).toEqual(["dmarc_no_reports"]);
      expect(
        codes({ dmarc: ["v=DMARC1; p=quarantine; pct=25; rua=mailto:a@b.com"] }),
      ).toEqual(["dmarc_partial"]);
    });
    it("multiple DMARC records are flagged", () => {
      expect(
        codes({
          dmarc: ["v=DMARC1; p=reject; rua=mailto:a@b.com", "v=DMARC1; p=none"],
        }),
      ).toContain("dmarc_multiple");
    });
  });

  it("no DKIM found is only a warning (selectors are not discoverable), and says so", () => {
    const f = analyzeDomainHealth({ ...good, dkimSelectors: [] }).findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "dkim_not_found", severity: "warning" });
    expect(f[0]!.message).toMatch(/özel bir seçici/);
  });

  it("no MX is a warning", () => {
    expect(codes({ mx: [] })).toEqual(["mx_missing"]);
  });

  it("a lookup failure is reported as incomplete and never as 'missing'", () => {
    const r = analyzeDomainHealth({
      ...good,
      txt: [],
      dmarc: [],
      lookupFailures: ["ornek.com", "_dmarc.ornek.com"],
    });
    expect(r.incomplete).toBe(true);
    expect(r.findings.map((f) => f.code)).not.toEqual(
      expect.arrayContaining(["spf_missing"]),
    );
    expect(r.findings.map((f) => f.code)).not.toEqual(
      expect.arrayContaining(["dmarc_missing"]),
    );
  });

  it("scores and bands the way the in-app deliverability center does; worst first", () => {
    const r = analyzeDomainHealth({
      domain: "x.com",
      txt: [],
      dmarc: [],
      dkimSelectors: [],
      mx: [],
    });
    expect(r.band).toBe("risky");
    expect(r.findings.map((f) => f.severity)).toEqual([
      "critical",
      "critical",
      "warning",
      "warning",
    ]);
    expect(r.score).toBe(100 - 30 - 30 - 10 - 10);
  });
});
