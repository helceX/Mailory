import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND, CAMPAIGN_PLAYBOOKS } from "@mailory/core";
import { emailDocSchema, createCampaignSchema } from "@mailory/validation";
import { buildPlaybook } from "./playbook";
import { buildMergeValues } from "./merge";
import { renderEmail } from "./render";

describe("business goal starters", () => {
  for (const kind of ["first_sale", "demo", "reactivation"] as const) {
    it(`${kind} produces a valid editable, branded email with a real action and unsubscribe`, () => {
      const { doc, plan } = buildPlaybook(
        { ...DEFAULT_BRAND, footerText: "Acme Ankara", buttonColor: "#123456" },
        {
          kind,
          proposition: "Ekibiniz için tek noktadan müşteri yönetimi.",
          actionUrl: "https://example.org/book",
          measureImpact: false,
        },
      );
      expect(emailDocSchema.safeParse(doc).success).toBe(true);
      expect(plan.goal).toBe(CAMPAIGN_PLAYBOOKS[kind].goal);
      expect(doc.blocks.filter((b) => b.type === "button")).toHaveLength(1);
      const rendered = renderEmail(doc, {
        appUrl: "https://app.test",
        values: buildMergeValues(
          { firstName: "Ayşe" },
          {
            unsubscribeUrl: "https://app.test/u/test",
            viewInBrowserUrl: "https://app.test/v/test",
            orgName: "Acme",
          },
        ),
      });
      expect(rendered.html).toContain("https://example.org/book");
      expect(rendered.html).toContain("https://app.test/u/test");
      expect(rendered.html).toContain("Acme Ankara");
      expect(rendered.html).toContain("Ayşe");
    });
  }
  it.each([
    "not-url",
    "http://example.org",
    "javascript:alert(1)",
    "https://user:password@example.org",
  ])("rejects unusable or credential-bearing actions: %s", (actionUrl) => {
    expect(
      createCampaignSchema.safeParse({
        name: "Demo",
        playbook: {
          kind: "demo",
          proposition: "Ürünü birlikte inceleyelim.",
          actionUrl,
        },
      }).success,
    ).toBe(false);
  });
  it("keeps blank drafts compatible and impact opt-in", () => {
    expect(createCampaignSchema.parse({ name: "Boş" })).toEqual({ name: "Boş" });
    expect(
      createCampaignSchema.parse({
        name: "Demo",
        playbook: {
          kind: "demo",
          proposition: "Ürünü birlikte inceleyelim.",
          actionUrl: "https://example.org",
        },
      }).playbook?.measureImpact,
    ).toBe(false);
  });
});
