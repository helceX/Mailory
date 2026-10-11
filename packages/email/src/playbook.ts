import {
  CAMPAIGN_PLAYBOOKS,
  createBlock,
  type BrandKit,
  type CampaignPlaybookInput,
  type HeadingBlock,
  type ParagraphBlock,
  type ButtonBlock,
} from "@mailory/core";
import { blankTemplate } from "./library";
/** A normal editable native template. No generated claim, discount, or external model call. */
export function buildPlaybook(brand: BrandKit, input: CampaignPlaybookInput) {
  const plan = CAMPAIGN_PLAYBOOKS[input.kind],
    doc = blankTemplate(brand);
  doc.settings.preheader = input.proposition.slice(0, 150);
  const shell = doc.blocks.filter(
    (b) => b.type === "logo" || b.type === "footer" || b.type === "social",
  );
  const body = [
    { ...(createBlock("heading") as HeadingBlock), text: plan.heading },
    {
      ...(createBlock("paragraph") as ParagraphBlock),
      text: "Merhaba {{first_name|dost}},",
    },
    { ...(createBlock("paragraph") as ParagraphBlock), text: input.proposition },
    {
      ...(createBlock("button") as ButtonBlock),
      label: plan.action,
      href: input.actionUrl,
    },
  ];
  doc.blocks = [
    ...shell.filter((b) => b.type === "logo"),
    ...body,
    ...shell.filter((b) => b.type !== "logo"),
  ];
  return { doc, plan };
}
