import { z } from "zod";
import { emailSchema } from "./audience";

const uuid = z.string().uuid();
const utmValue = z
  .string()
  .trim()
  .max(80)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "Yalnızca küçük harf, rakam, '-', '_' ve '.' kullanın.",
  );

export const campaignAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("list"), id: uuid }),
  z.object({ kind: z.literal("segment"), id: uuid }),
  z.object({ kind: z.literal("tag"), id: uuid }),
]);

export const campaignUtmSchema = z.object({
  enabled: z.boolean(),
  source: utmValue,
  medium: utmValue,
  campaign: z.union([z.literal(""), utmValue]),
  content: z.union([z.literal(""), utmValue]).optional(),
  term: z.union([z.literal(""), utmValue]).optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, "Kampanya adı gerekli.").max(120),
});

/** Partial update of a draft; every field optional so the wizard can save step by step. */
export const campaignDraftSchema = z.object({
  name: z.string().trim().min(1, "Kampanya adı gerekli.").max(120).optional(),
  subject: z.string().trim().max(200).optional(),
  preheader: z.string().trim().max(200).optional(),
  senderIdentityId: uuid.nullable().optional(),
  replyTo: z
    .union([z.literal(""), emailSchema])
    .nullable()
    .transform((v) => (v ? v : null))
    .optional(),
  templateId: uuid.nullable().optional(),
  audience: campaignAudienceSchema.nullable().optional(),
  utm: campaignUtmSchema.optional(),
  trackOpens: z.boolean().optional(),
  trackClicks: z.boolean().optional(),
});
export type CampaignDraftInput = z.infer<typeof campaignDraftSchema>;

export const scheduleSchema = z.object({
  /** ISO timestamp; null/absent means "as soon as possible". */
  sendAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const rejectCampaignSchema = z.object({
  reason: z.string().trim().min(1, "Gerekçe gerekli.").max(500),
});

export const testSendSchema = z.object({
  recipients: z.array(emailSchema).min(1, "En az bir alıcı seçin.").max(5),
});

export const campaignPolicySchema = z
  .object({
    requireApproval: z.boolean().optional(),
    /** Max emails per contact per rolling 7 days across campaigns; null removes the cap. */
    weeklyCap: z.number().int().min(1).max(50).nullable().optional(),
  })
  .refine((v) => v.requireApproval !== undefined || v.weeklyCap !== undefined, {
    message: "Değiştirilecek bir ayar belirtin.",
  });
