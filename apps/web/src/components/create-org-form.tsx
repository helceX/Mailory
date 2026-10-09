"use client";

import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@mailory/ui";
import { FormError } from "./auth/auth-card";
import { useAuthForm } from "./auth/use-auth-form";

export function CreateOrgForm() {
  const router = useRouter();
  const { pending, error, submit } = useAuthForm("/api/organizations", () => {
    router.replace("/dashboard");
    router.refresh();
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ name: new FormData(event.currentTarget).get("name") });
      }}
    >
      <FormError message={error} />
      <Field
        id="name"
        label="Organizasyon adı"
        hint="Örn. şirket veya ekip adınız."
        required
      >
        <Input
          name="name"
          required
          minLength={2}
          maxLength={80}
          autoComplete="organization"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Oluşturuluyor…" : "Organizasyon oluştur"}
      </Button>
    </form>
  );
}
