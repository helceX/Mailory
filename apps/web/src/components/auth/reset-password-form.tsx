"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@mailory/ui";
import { FormError, Notice } from "./auth-card";
import { useAuthForm } from "./use-auth-form";

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const { pending, error, submit } = useAuthForm("/api/auth/reset-password", () =>
    setDone(true),
  );
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>
          Parolanız güncellendi. Güvenliğiniz için tüm oturumlar kapatıldı.
        </Notice>
        <Link
          href="/login"
          className="text-center text-sm text-primary hover:underline"
        >
          Giriş yap
        </Link>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          token,
          password: new FormData(event.currentTarget).get("password"),
        });
      }}
    >
      <FormError message={error} />
      <Field id="password" label="Yeni parola" hint="En az 10 karakter." required>
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
        {pending ? "Kaydediliyor…" : "Parolayı güncelle"}
      </Button>
    </form>
  );
}
