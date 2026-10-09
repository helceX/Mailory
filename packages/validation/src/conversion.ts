import { z } from "zod";

const NINETY_DAYS = 90 * 86_400_000;

/** An outcome reported by the customer's own system (purchase, registration…). Identify the person by e-mail or contact id. */
export const conversionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Dönüşüm adı gerekli (örn. purchase).")
      .max(60)
      .regex(
        /^[\p{L}\p{N}_.\- ]+$/u,
        "Ad yalnızca harf, rakam, boşluk, _ . - içerebilir.",
      ),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    contactId: z.uuid().optional(),
    value: z.number().finite().min(0).max(1_000_000_000).default(0),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Para birimi 3 harfli kod olmalı (örn. TRY).")
      .default("TRY"),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    externalId: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => v.email !== undefined || v.contactId !== undefined, {
    message: "email veya contactId gerekli.",
  })
  .refine(
    (v) => {
      if (!v.occurredAt) return true;
      const t = new Date(v.occurredAt).getTime();
      return t <= Date.now() + 5 * 60_000 && t >= Date.now() - NINETY_DAYS;
    },
    { message: "occurredAt gelecekte olamaz ve en çok 90 gün öncesine ait olabilir." },
  );
export type ConversionInput = z.infer<typeof conversionSchema>;
