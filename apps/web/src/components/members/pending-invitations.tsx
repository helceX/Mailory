"use client";

import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@mailory/ui";
import type { OrgRole } from "@mailory/core/shared";
import { ROLE_LABELS } from "./role-labels";

type Invitation = { id: string; email: string; role: string; expiresAt: string };

export function PendingInvitations({ invitations }: { invitations: Invitation[] }) {
  const router = useRouter();
  return (
    <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
      <h2 id="invites-heading" className="text-sm font-semibold">
        Bekleyen davetler ({invitations.length})
      </h2>
      {invitations.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Bekleyen davet yok. Yukarıdan e-posta adresiyle yeni üye davet edebilirsiniz.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-surface">
          {invitations.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{i.email}</div>
                <div className="text-xs text-muted-foreground">
                  {ROLE_LABELS[i.role as OrgRole]} ·{" "}
                  {new Date(i.expiresAt).toLocaleDateString("tr-TR")} tarihine kadar
                  geçerli
                </div>
              </div>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm">
                    İptal et
                  </Button>
                }
                title="Davet iptal edilsin mi?"
                description={`${i.email} adresine gönderilen davet bağlantısı artık çalışmaz.`}
                confirmLabel="Daveti iptal et"
                cancelLabel="Vazgeç"
                onConfirm={async () => {
                  await fetch(`/api/org/invitations/${i.id}`, { method: "DELETE" });
                  router.refresh();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
