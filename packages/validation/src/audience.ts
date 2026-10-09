import { z } from "zod";
import {
  CUSTOM_FIELD_KEY_RE,
  RESERVED_FIELD_KEYS,
  isValidEmail,
  normalizeEmail,
} from "@mailory/core";

export const CONTACT_STATUSES = [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
  "cleaned",
] as const;
export const CONSENT_STATUSES = ["granted", "unknown", "withdrawn"] as const;
export const SUPPRESSION_REASONS = [
  "unsubscribe",
  "hard_bounce",
  "complaint",
  "manual",
  "import",
] as const;
export const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .refine(isValidEmail, { message: "Geçerli bir e-posta adresi girin." });

export const contactInputSchema = z.object({
  email: emailSchema,
  firstName: optionalText(80),
  lastName: optionalText(80),
  company: optionalText(120),
  position: optionalText(120),
  website: optionalText(200),
  phone: optionalText(40),
  sector: optionalText(80),
  city: optionalText(80),
  source: optionalText(80),
  status: z.enum(CONTACT_STATUSES).optional(),
  consentStatus: z.enum(CONSENT_STATUSES).optional(),
  consentSource: optionalText(120),
  custom: z
    .record(
      z.string().regex(CUSTOM_FIELD_KEY_RE),
      z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
    )
    .optional(),
});
export const contactPatchSchema = contactInputSchema.partial();
export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  consentStatus: z.enum(CONSENT_STATUSES).optional(),
  listId: z.uuid().optional(),
  tagId: z.uuid().optional(),
  segmentId: z.uuid().optional(),
});
export type ContactFilterInput = z.infer<typeof contactFilterSchema>;

/** A bulk action targets explicit ids (max 1000) or "everything matching this filter". */
export const bulkTargetSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(1000) }),
  z.object({ filter: contactFilterSchema }),
]);

export const bulkActionSchema = z.intersection(
  bulkTargetSchema,
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("delete") }),
    z.object({ action: z.literal("set_status"), status: z.enum(CONTACT_STATUSES) }),
    z.object({ action: z.literal("add_to_list"), listId: z.uuid() }),
    z.object({ action: z.literal("remove_from_list"), listId: z.uuid() }),
    z.object({ action: z.literal("add_tag"), tagId: z.uuid() }),
    z.object({ action: z.literal("remove_tag"), tagId: z.uuid() }),
  ]),
);

export const nameSchema = z.object({
  name: z.string().trim().min(1, "Ad gerekli.").max(80),
  description: optionalText(300),
});

export const customFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      CUSTOM_FIELD_KEY_RE,
      "Anahtar küçük harfle başlamalı; yalnızca küçük harf, rakam ve alt çizgi içerebilir.",
    )
    .refine((k) => !RESERVED_FIELD_KEYS.includes(k), {
      message: "Bu anahtar sistem alanı olarak ayrılmış.",
    }),
  label: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});

export const suppressionAddSchema = z.object({
  emails: z.array(emailSchema).min(1).max(1000),
  reason: z.enum(SUPPRESSION_REASONS).default("manual"),
});

export const IMPORT_TARGETS = [
  "email",
  "first_name",
  "last_name",
  "company",
  "position",
  "website",
  "phone",
  "sector",
  "city",
  "source",
] as const;

export const importPreviewSchema = z.object({ csv: z.string().min(1).max(8_000_000) });
export const importRunSchema = z.object({
  csv: z.string().min(1).max(8_000_000),
  /** header → target ("email" | "first_name" | … | "custom:<key>"); unmapped headers are ignored. */
  mapping: z.record(z.string().max(200), z.string().max(60)),
  filename: z.string().max(200).optional(),
  listId: z.uuid().optional(),
  tagIds: z.array(z.uuid()).max(20).optional(),
  updateExisting: z.boolean().default(false),
  /** The importer must state the recipients consented; stored with the job as proof. */
  consentAttested: z.literal(true, {
    message: "İçe aktarmadan önce izin beyanını onaylamalısınız.",
  }),
});

export type BulkAction = z.infer<typeof bulkActionSchema>;
export type ImportRunInput = z.infer<typeof importRunSchema>;
