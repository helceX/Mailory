"use client";

import { useRouter } from "next/navigation";
import { Button } from "@mailory/ui";
import { FormError } from "./auth/auth-card";
import { useAuthForm } from "./auth/use-auth-form";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const { pending, error, submit } = useAuthForm("/api/invitations/accept", () => {
    router.replace("/dashboard");
    router.refresh();
  });
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Button disabled={pending} onClick={() => void submit({ token })}>
        {pending ? "Kabul ediliyor…" : "Daveti kabul et"}
      </Button>
    </div>
  );
}
