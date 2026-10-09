"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Globe } from "lucide-react";
import { Badge, Button, EmptyState, Field, Input } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";
import { DOMAIN_STATUS } from "./labels";

type Row = { id: string; domain: string; status: string; lastCheckedAt: string | null };

export function DomainsManager({
  domains,
  canManage,
}: {
  domains: Row[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    const result = await apiCall("/api/sender-domains", "POST", {
      domain: String(new FormData(form).get("domain") ?? ""),
    });
    setPending(false);
    if (!result.ok) return setError(result.message);
    router.push(`/settings/domains/${(result.data as { id: string }).id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <form
          onSubmit={add}
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-4"
        >
          <Field
            id="domain"
            label="Alan adı ekle"
            hint="Gönderici adresinizin alan adı. Örn. sirketiniz.com (e-posta adresi değil)."
            className="min-w-[260px] flex-1"
          >
            <Input
              name="domain"
              required
              placeholder="sirketiniz.com"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Ekleniyor…" : "Alan adı ekle"}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
      {domains.length === 0 ? (
        <EmptyState
          icon={<Globe className="size-6" aria-hidden="true" />}
          title="Henüz doğrulanmış bir alan adınız yok."
          description="E-postalarınızın spam'e düşmemesi için kendi alan adınızı ekleyip doğrulayın. Doğrulama birkaç DNS kaydı eklemekten ibarettir; size adım adım göstereceğiz."
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-surface">
          {domains.map((d) => {
            const status = DOMAIN_STATUS[d.status] ?? {
              label: d.status,
              tone: "neutral" as const,
            };
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium">{d.domain}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.lastCheckedAt
                      ? `Son kontrol: ${new Date(d.lastCheckedAt).toLocaleString("tr-TR")}`
                      : "Henüz kontrol edilmedi"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {canManage ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/settings/domains/${d.id}`}>
                        {d.status === "verified" ? "Ayrıntılar" : "DNS kayıtları"}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
