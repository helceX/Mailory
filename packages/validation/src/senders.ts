import { z } from "zod";
import { emailSchema } from "./audience";

export const addDomainSchema = z.object({
  domain: z.string().trim().min(1, "Alan adı gerekli.").max(253),
});

const optionalEmail = z
  .union([z.literal(""), emailSchema])
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const senderIdentitySchema = z.object({
  fromName: z.string().trim().min(1, "Gönderici adı gerekli.").max(80),
  fromEmail: emailSchema,
  replyTo: optionalEmail,
});
export type SenderIdentityInput = z.infer<typeof senderIdentitySchema>;
