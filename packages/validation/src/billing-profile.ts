import { z } from "zod";
import { classifyTaxId } from "@mailory/core/shared";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label} gerekli`).max(max, `${label} çok uzun`);
const optionalText = (max: number) => z.string().trim().max(max).default("");

/** Invoice details. The tax number's length and check digits are verified so a typo never reaches a legal invoice. */
export const billingProfileSchema = z
  .object({
    legalName: text("Unvan", 200),
    taxOffice: text("Vergi dairesi", 120),
    taxId: z
      .string()
      .trim()
      .regex(/^\d{10,11}$/, "Vergi numarası 10 (VKN) veya 11 (TCKN) haneli olmalı"),
    addressLine: text("Adres", 300),
    district: optionalText(100),
    city: text("İl", 100),
    postalCode: optionalText(20),
    // Invoicing is Turkey-only for now (e-Fatura / e-Arşiv).
    country: z.literal("TR").default("TR"),
    invoiceEmail: z.email("Geçerli bir e-posta girin").max(255).toLowerCase(),
  })
  .superRefine((value, ctx) => {
    if (classifyTaxId(value.taxId) === null)
      ctx.addIssue({
        code: "custom",
        path: ["taxId"],
        message: "Bu vergi numarası geçerli değil; yazım hatası olabilir",
      });
  });
export type BillingProfileValues = z.infer<typeof billingProfileSchema>;
