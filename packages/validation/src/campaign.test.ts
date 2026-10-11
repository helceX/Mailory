import { describe, expect, it } from "vitest";
import { campaignAudienceSchema, campaignDraftSchema } from "./campaign";

describe("campaign economy mode validation", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  it("keeps existing audiences compatible and retains an explicit opt-in across all sources", () => {
    for (const kind of ["all", "list", "tag", "segment"]) {
      const audience = kind === "all" ? { kind } : { kind, id };
      expect(campaignAudienceSchema.parse(audience)).toEqual(audience);
      expect(
        campaignDraftSchema.parse({ audience: { ...audience, excludeDormant: true } })
          .audience?.excludeDormant,
      ).toBe(true);
      expect(
        campaignAudienceSchema.parse({ ...audience, excludeDormant: false })
          .excludeDormant,
      ).toBe(false);
    }
  });
  it("rejects string flags and missing or malformed source IDs", () => {
    expect(
      campaignAudienceSchema.safeParse({ kind: "all", excludeDormant: "false" })
        .success,
    ).toBe(false);
    expect(
      campaignAudienceSchema.safeParse({ kind: "list", excludeDormant: true }).success,
    ).toBe(false);
    expect(
      campaignAudienceSchema.safeParse({
        kind: "tag",
        id: "not-a-uuid",
        excludeDormant: true,
      }).success,
    ).toBe(false);
  });
});
