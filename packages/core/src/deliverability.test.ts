import { describe, expect, it } from "vitest";
import { createEmptyDoc, createBlock, type EmailDoc } from "./email-doc";
import {
  RATE_LIMITS,
  engagementBand,
  engagementScore,
  healthBand,
  reviewAudience,
  reviewContent,
  reviewRates,
  reviewSender,
  reviewSubject,
  scoreFindings,
  spamPhraseHits,
} from "./deliverability";

const codes = (f: { code: string }[]) => f.map((x) => x.code);
function docWith(...blocks: ReturnType<typeof createBlock>[]): EmailDoc {
  const d = createEmptyDoc();
  d.blocks = blocks as EmailDoc["blocks"];
  return d;
}
const para = (text: string) =>
  ({ ...createBlock("paragraph"), text }) as ReturnType<typeof createBlock>;

describe("subject review", () => {
  it("flags caps, punctuation, spam phrases and length, in Turkish and English", () => {
    expect(codes(reviewSubject("ÜCRETSİZ KAMPANYA ŞİMDİ BAŞLADI!!!"))).toEqual(
      expect.arrayContaining(["subject_caps", "subject_punct", "subject_spam_words"]),
    );
    expect(codes(reviewSubject("Act now: free winner"))).toContain(
      "subject_spam_words",
    );
    expect(codes(reviewSubject("x".repeat(90)))).toContain("subject_long");
    expect(codes(reviewSubject("Merhaba"))).toContain("subject_short");
  });
  it("leaves a normal subject alone and ignores an empty one", () => {
    expect(reviewSubject("Mart ayı bülteni: yeni özellikler")).toEqual([]);
    expect(reviewSubject("  ")).toEqual([]);
  });
  it("handles Turkish dotted/dotless I in the caps check", () => {
    expect(codes(reviewSubject("İNDİRİM BAŞLADI ŞİMDİ"))).toContain("subject_caps");
    expect(codes(reviewSubject("Iğdır'da yeni şube açıldı"))).not.toContain(
      "subject_caps",
    );
  });
  it("spam phrase matching is case/locale insensitive", () => {
    expect(spamPhraseHits("ÜCRETSİZ deneme")).toEqual(["ücretsiz"]);
  });
});

describe("content review", () => {
  const base = { subject: "Mart bülteni", preheader: "özet", hasUnsubscribe: true };
  it("a text email with an unsubscribe link is clean", () => {
    expect(
      reviewContent({
        ...base,
        doc: docWith(para("Merhaba, bu ay şunları yaptık. ".repeat(6))),
      }),
    ).toEqual([]);
  });
  it("flags image-only mail, missing alt, many links, shorteners, thin content", () => {
    const img = { ...createBlock("image"), alt: "" } as ReturnType<typeof createBlock>;
    expect(codes(reviewContent({ ...base, doc: docWith(img) }))).toEqual(
      expect.arrayContaining(["image_heavy", "image_alt"]),
    );
    const links = Array.from(
      { length: 12 },
      (_, i) =>
        ({ ...createBlock("button"), href: `https://x.com/${i}` }) as ReturnType<
          typeof createBlock
        >,
    );
    expect(
      codes(reviewContent({ ...base, doc: docWith(para("m ".repeat(100)), ...links) })),
    ).toContain("many_links");
    expect(
      codes(
        reviewContent({
          ...base,
          doc: docWith(para("m ".repeat(100) + " https://bit.ly/abc")),
        }),
      ),
    ).toContain("url_shortener");
    expect(codes(reviewContent({ ...base, doc: docWith(para("kısa")) }))).toContain(
      "thin_content",
    );
  });
  it("a missing unsubscribe link is critical and drops the score below 'risky' when combined", () => {
    const f = reviewContent({
      ...base,
      subject: "ÜCRETSİZ KAZAN!!!",
      hasUnsubscribe: false,
      doc: docWith(para("kısa")),
    });
    expect(f.find((x) => x.code === "no_unsubscribe")?.severity).toBe("critical");
    expect(healthBand(scoreFindings(f))).toBe("risky");
  });
});

describe("scoring", () => {
  it("weights severities and floors at zero", () => {
    expect(scoreFindings([])).toBe(100);
    expect(
      scoreFindings([{ code: "a", severity: "warning", message: "", fix: "" }]),
    ).toBe(90);
    expect(
      scoreFindings(
        Array.from({ length: 5 }, () => ({
          code: "c",
          severity: "critical" as const,
          message: "",
          fix: "",
        })),
      ),
    ).toBe(0);
    expect([healthBand(90), healthBand(70), healthBand(40)]).toEqual([
      "good",
      "attention",
      "risky",
    ]);
  });
});

describe("sender, audience and rates", () => {
  it("sender: unverified is critical; missing SPF/DMARC warn; all good is clean", () => {
    expect(codes(reviewSender(null))).toEqual(["sender_unverified"]);
    expect(
      codes(
        reviewSender({ verified: true, spfState: "missing", dmarcState: "missing" }),
      ),
    ).toEqual(["spf_missing", "dmarc_missing"]);
    expect(reviewSender({ verified: true, spfState: "ok", dmarcState: "ok" })).toEqual(
      [],
    );
  });
  it("audience: warns on cold-heavy lists only with enough scored data", () => {
    expect(
      codes(reviewAudience({ size: 100, cold: 30, dormant: 20, scored: 60 }, 5000)),
    ).toContain("cold_audience");
    expect(
      reviewAudience({ size: 100, cold: 30, dormant: 20, scored: 20 }, 5000),
    ).toEqual([]);
    expect(
      codes(reviewAudience({ size: 9000, cold: 0, dormant: 0, scored: 0 }, 2000)),
    ).toContain("over_daily_limit");
  });
  it("rates need a minimum sample, then warn and go critical at the thresholds", () => {
    expect(
      reviewRates({ sent: 40, bounced: 40, complained: 40, unsubscribed: 0 }),
    ).toEqual([]);
    const n = 1000;
    expect(
      codes(
        reviewRates({
          sent: n,
          bounced: n * RATE_LIMITS.bounceWarn,
          complained: 0,
          unsubscribed: 0,
        }),
      ),
    ).toEqual(["bounce_warn"]);
    expect(
      codes(
        reviewRates({ sent: n, bounced: n * 0.06, complained: 4, unsubscribed: 0 }),
      ),
    ).toEqual(["bounce_critical", "complaint_critical"]);
    expect(
      codes(reviewRates({ sent: n, bounced: 0, complained: 0, unsubscribed: 15 })),
    ).toEqual(["unsub_warn"]);
  });
});

describe("engagement", () => {
  it("is unscored until a contact has received enough mail", () => {
    expect(engagementScore({ sent: 2, opened: 2, clicked: 2 })).toBeNull();
    expect(engagementBand(null)).toBe("new");
  });
  it("combines opens and (tripled) clicks and bands the result", () => {
    expect(engagementScore({ sent: 10, opened: 10, clicked: 4 })).toBe(100);
    expect(engagementScore({ sent: 10, opened: 5, clicked: 0 })).toBe(25);
    expect(engagementBand(100)).toBe("hot");
    expect(engagementBand(40)).toBe("warm");
    expect(engagementBand(10, 8)).toBe("cold");
    expect(engagementBand(0, 8)).toBe("dormant");
    expect(engagementBand(0, 3)).toBe("cold");
  });
  it("never exceeds 100 even if counters are inconsistent", () => {
    expect(engagementScore({ sent: 3, opened: 9, clicked: 9 })).toBe(100);
  });
});
