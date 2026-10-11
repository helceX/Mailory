"use client";

import { useState } from "react";
import { Button, Field, Input } from "@mailory/ui";
import { FormError, Notice } from "./auth-card";
import { useAuthForm } from "./use-auth-form";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const { pending, error, submit } = useAuthForm("/api/auth/forgot-password", () =>
    setDone(true),
  );
  if (done)
    return (
      <Notice>
        Bu adrese kayıtlı bir hesap varsa, parola sıfırlama bağlantısı gönderildi.
      </Notice>
    );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ email: new FormData(event.currentTarget).get("email") });
      }}
    >
      <FormError message={error} />
      <Field id="email" label="E-posta" required>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
      </Button>
    </form>
  );
}
