import { z } from "zod";
import type { Step } from "@mailory/core/shared";
import { campaignAudienceSchema } from "./campaign";

const uuid = z.string().uuid();
const stepId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/);

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact_created") }),
  z.object({ type: z.literal("list_joined"), listId: uuid }),
  z.object({ type: z.literal("tag_added"), tagId: uuid }),
  z.object({ type: z.literal("manual") }),
]);

const emailStep = z.object({
  id: stepId,
  type: z.literal("email"),
  templateId: uuid,
  senderIdentityId: uuid,
  subject: z.string().trim().min(1, "Konu gerekli.").max(200),
  preheader: z.string().trim().max(200).optional(),
});
const waitStep = z.object({
  id: stepId,
  type: z.literal("wait"),
  amount: z.number().int().min(1).max(525_600),
  unit: z.enum(["minutes", "hours", "days"]),
});
const check = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opened_previous") }),
  z.object({ kind: z.literal("clicked_previous") }),
  z.object({ kind: z.literal("has_tag"), tagId: uuid }),
  z.object({ kind: z.literal("in_list"), listId: uuid }),
]);

export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("type", [
    emailStep,
    waitStep,
    z.object({
      id: stepId,
      type: z.literal("condition"),
      check,
      yes: z.array(stepSchema).max(20),
      no: z.array(stepSchema).max(20),
    }),
  ]),
) as z.ZodType<Step>;

export const createAutomationSchema = z.object({
  name: z.string().trim().min(1, "Ad gerekli.").max(120),
  trigger: triggerSchema.default({ type: "contact_created" }),
});
export const updateAutomationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  trigger: triggerSchema.optional(),
  steps: z.array(stepSchema).max(20).optional(),
});
export const enrollSchema = z.object({ audience: campaignAudienceSchema });
