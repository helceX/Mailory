import { describe, expect, it } from "vitest";
import { MockDnsResolver } from "./dns";
import { checkDomainHealth } from "./domain-health";

describe("checkDomainHealth", () => {
  it("reads SPF, DMARC, MX and a DKIM selector from DNS and finds nothing wrong", async () => {
    const r = new MockDnsResolver({
      "ornek.com": { TXT: ["v=spf1 include:amazonses.com ~all"], MX: ["mx.ornek.com"] },
      "_dmarc.ornek.com": { TXT: ["v=DMARC1; p=reject; rua=mailto:d@ornek.com"] },
      "google._domainkey.ornek.com": { TXT: ["v=DKIM1; k=rsa; p=MIGf"] },
    });
    const h = await checkDomainHealth(r, "ornek.com");
    expect(h.findings).toEqual([]);
    expect(h.facts.dkimSelectors).toEqual(["google"]);
    expect(h.facts.mx).toEqual(["mx.ornek.com"]);
  });
  it("accepts a CNAME-hosted DKIM key", async () => {
    const r = new MockDnsResolver({
      "ornek.com": { TXT: ["v=spf1 ~all"], MX: ["m.ornek.com"] },
      "_dmarc.ornek.com": { TXT: ["v=DMARC1; p=none; rua=mailto:a@b.com"] },
      "selector1._domainkey.ornek.com": {
        CNAME: ["selector1-ornek-com._domainkey.x.onmicrosoft.com"],
      },
    });
    expect((await checkDomainHealth(r, "ornek.com")).facts.dkimSelectors).toEqual([
      "selector1",
    ]);
  });
  it("an empty domain gets the full list of problems", async () => {
    const h = await checkDomainHealth(new MockDnsResolver({}), "bos.com");
    expect(h.findings.map((f) => f.code)).toEqual([
      "spf_missing",
      "dmarc_missing",
      "dkim_not_found",
      "mx_missing",
    ]);
    expect(h.band).toBe("risky");
  });
  it("a failing lookup is incomplete, not 'missing'", async () => {
    const r = new MockDnsResolver({
      "flaky.com": { FAIL: true },
      "_dmarc.flaky.com": { TXT: ["v=DMARC1; p=reject; rua=mailto:a@b.com"] },
    });
    const h = await checkDomainHealth(r, "flaky.com");
    expect(h.incomplete).toBe(true);
    expect(h.findings.map((f) => f.code)).not.toContain("spf_missing");
  });
});
