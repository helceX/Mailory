import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organizasyon adı en az 2 karakter olmalı.").max(80),
});

/** Owner is never granted by invitation; it exists only at org creation or by an owner's promotion. */
export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ message: "Geçerli bir e-posta adresi girin." })),
  role: z.enum(["admin", "editor", "viewer"]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "editor", "viewer"]),
});
export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(200) });
export const switchOrganizationSchema = z.object({ organizationId: z.uuid() });
