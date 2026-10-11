import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Geçerli bir e-posta adresi girin." }));

/** NIST-style: length over composition rules. Upper bound guards against hashing DoS. */
const password = z
  .string()
  .min(10, "Parola en az 10 karakter olmalı.")
  .max(128, "Parola en fazla 128 karakter olabilir.");

const name = (label: string) => z.string().trim().min(1, `${label} gerekli.`).max(80);

export const registerSchema = z.object({
  email,
  password,
  firstName: name("Ad"),
  lastName: name("Soyad"),
});

export const loginSchema = z.object({
  email,
  // Login must not leak policy: any non-empty string is attempted.
  password: z.string().min(1, "Parola gerekli.").max(128),
});

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
