"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@mailory/ui";
import { FormError } from "./auth-card";
import { useAuthForm } from "./use-auth-form";

export function LoginForm() {
  const router = useRouter();
  const { pending, error, submit } = useAuthForm("/api/auth/login", () => {
    router.replace("/dashboard");
    router.refresh();
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({ email: form.get("email"), password: form.get("password") });
      }}
    >
      <FormError message={error} />
      <Field id="email" label="E-posta" required>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field id="password" label="Parola" required>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </Button>
      <Link
        href="/forgot-password"
        className="text-center text-sm text-primary hover:underline"
      >
        Parolamı unuttum
      </Link>
    </form>
  );
}
