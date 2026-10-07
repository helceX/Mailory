"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OrgRole } from "@mailory/core";
import { Button, Field, Input } from "@mailory/ui";
import { FormError, Notice } from "../auth/auth-card";
import { useAuthForm } from "../auth/use-auth-form";
import { assignableRoles, ROLE_HINTS, ROLE_LABELS } from "./role-labels";

export function InviteForm({ actorRole }: { actorRole: OrgRole }) {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const roles = assignableRoles(actorRole).filter((r) => r !== "owner");
  const [role, setRole] = useState<string>(roles[roles.length - 1] ?? "viewer");
  const { pending, error, submit } = useAuthForm("/api/org/invitations", () =>
    router.refresh(),
  );

  if (roles.length === 0) return null;
  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-surface p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const email = String(new FormData(form).get("email"));
        await submit({ email, role });
        setSentTo(email);
        form.reset();
      }}
    >
      <h2 className="text-sm font-semibold">Üye davet et</h2>
      <FormError message={error} />
      {sentTo && !error ? <Notice>{sentTo} adresine davet gönderildi.</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field id="invite-email" label="E-posta" required>
          <Input name="email" type="email" required autoComplete="off" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Rol
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            aria-describedby="invite-role-hint"
            className="h-9 rounded border border-border bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Gönderiliyor…" : "Davet gönder"}
        </Button>
      </div>
      <p id="invite-role-hint" className="text-xs text-muted-foreground">
        {ROLE_HINTS[role as OrgRole]}
      </p>
    </form>
  );
}
