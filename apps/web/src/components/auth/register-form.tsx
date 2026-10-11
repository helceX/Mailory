"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@mailory/ui";
import { FormError, Notice } from "./auth-card";
import { useAuthForm } from "./use-auth-form";

export function RegisterForm() {
  const [done, setDone] = useState(false);
  const { pending, error, submit } = useAuthForm("/api/auth/register", () =>
    setDone(true),
  );
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>
          Neredeyse hazır! E-posta adresinize bir doğrulama bağlantısı gönderdik. Gelen
          kutunuzu kontrol edin.
        </Notice>
        <Link
          href="/login"
          className="text-center text-sm text-primary hover:underline"
        >
          Giriş sayfasına dön
        </Link>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void submit({
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          email: form.get("email"),
          password: form.get("password"),
        });
      }}
    >
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="firstName" label="Ad" required>
          <Input name="firstName" autoComplete="given-name" required maxLength={80} />
        </Field>
        <Field id="lastName" label="Soyad" required>
          <Input name="lastName" autoComplete="family-name" required maxLength={80} />
        </Field>
      </div>
      <Field id="email" label="E-posta" required>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field id="password" label="Parola" hint="En az 10 karakter." required>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Hesap oluşturuluyor…" : "Hesap oluştur"}
      </Button>
    </form>
  );
}
