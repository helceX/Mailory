"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { canManageMember, type OrgRole } from "@mailory/core/shared";
import { Badge, Button, ConfirmDialog } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { assignableRoles, ROLE_LABELS } from "./role-labels";

type Member = { userId: string; name: string; email: string; role: OrgRole };

async function call(
  url: string,
  method: string,
  body?: unknown,
): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? "İşlem tamamlanamadı.";
}

export function MembersTable({
  members,
  currentUserId,
  actorRole,
}: {
  members: Member[];
  currentUserId: string;
  actorRole: OrgRole;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const assignable = assignableRoles(actorRole);

  async function run(action: Promise<string | null>) {
    setError(null);
    const message = await action;
    if (message) setError(message);
    router.refresh();
  }

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <h2 id="members-heading" className="text-sm font-semibold">
        Ekip ({members.length})
      </h2>
      <FormError message={error} />
      <div className="relative overflow-x-auto rounded-lg border bg-surface">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-surface-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Üye
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Rol
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                <span className="sr-only">İşlemler</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const manageable = !isSelf && canManageMember(actorRole, m.role);
              return (
                <tr key={m.userId}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {m.name}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (siz)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {manageable ? (
                      <>
                        <label htmlFor={`role-${m.userId}`} className="sr-only">
                          {m.name} rolü
                        </label>
                        <select
                          id={`role-${m.userId}`}
                          value={m.role}
                          className="h-8 rounded border border-border bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onChange={(event) =>
                            run(
                              call(`/api/org/members/${m.userId}`, "PATCH", {
                                role: event.target.value,
                              }),
                            )
                          }
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <Badge tone={m.role === "owner" ? "info" : "neutral"}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {manageable ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Kaldır
                          </Button>
                        }
                        title={`${m.name} kaldırılsın mı?`}
                        description="Bu kişi organizasyona erişimini hemen kaybeder. İsterseniz daha sonra yeniden davet edebilirsiniz."
                        confirmLabel="Kaldır"
                        onConfirm={() =>
                          run(call(`/api/org/members/${m.userId}`, "DELETE"))
                        }
                      />
                    ) : isSelf ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Ayrıl
                          </Button>
                        }
                        title="Organizasyondan ayrılmak istiyor musunuz?"
                        description="Bu organizasyonun verilerine erişiminizi kaybedersiniz. Yalnızca bir yönetici sizi yeniden davet edebilir."
                        confirmLabel="Ayrıl"
                        onConfirm={() =>
                          run(call(`/api/org/members/${m.userId}`, "DELETE"))
                        }
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
