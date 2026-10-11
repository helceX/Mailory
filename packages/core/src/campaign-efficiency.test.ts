import { describe, expect, it } from "vitest";
import {
  economicalAudienceHealth,
  measureContent,
  planAudience,
  reviewContentEfficiency,
} from "./campaign-efficiency";

describe("campaign efficiency", () => {
  it("excludes only known dormant contacts and preserves new/unscored contacts", () => {
    const health = { size: 1000, scored: 700, cold: 200, dormant: 400 };
    expect(planAudience(health)).toEqual({
      standard: 1000,
      economical: 600,
      avoided: 400,
      reductionPercent: 40,
      unscored: 300,
    });
    expect(economicalAudienceHealth(health)).toEqual({
      size: 600,
      scored: 300,
      cold: 200,
      dormant: 0,
    });
    expect(health.dormant).toBe(400);
  });
  it("does not invent savings for an empty or entirely new audience", () => {
    expect(
      planAudience({ size: 0, scored: 0, dormant: 0, cold: 0 }).reductionPercent,
    ).toBe(0);
    expect(planAudience({ size: 500, scored: 0, dormant: 0, cold: 0 })).toMatchObject({
      economical: 500,
      avoided: 0,
      unscored: 500,
    });
  });
  it("uses UTF-8 bytes, counts Turkish words and ignores URLs in reading time", () => {
    const html = "<p>İyi günler 🌟</p>";
    const result = measureContent(
      html,
      "İyi günler! https://example.com/uzun-adres Merhaba dünya",
    );
    expect(result.htmlBytes).toBe(Buffer.byteLength(html, "utf8"));
    expect(result.htmlBytes).toBeGreaterThan(html.length);
    expect(result.wordCount).toBe(4);
    expect(result.readingSeconds).toBe(2);
  });
  it("warns conservatively at byte boundaries, without promising inbox delivery", () => {
    expect(measureContent("a".repeat(80 * 1024 - 1), "").sizeBand).toBe("small");
    expect(measureContent("a".repeat(80 * 1024), "").sizeBand).toBe("near_limit");
    const over = measureContent("a".repeat(102 * 1024), "");
    expect(over.sizeBand).toBe("over_limit");
    expect(reviewContentEfficiency(over)[0]?.code).toBe("email_clipping_risk");
    expect(
      reviewContentEfficiency(measureContent("<p>Merhaba</p>", "Merhaba")),
    ).toEqual([]);
    expect(
      reviewContentEfficiency(measureContent("<p>Text</p>", "kelime ".repeat(601)))[0]
        ?.code,
    ).toBe("long_reading_time");
  });
});
