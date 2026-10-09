import { ScrollText } from "lucide-react";
import { EmptyState } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { listOrgAudit } from "@/lib/org/service";

export const metadata = { title: "Denetim kaydı" };

const ACTION_LABELS: Record<string, string> = {
  "org.created": "Organizasyon oluşturuldu",
  "member.invited": "Üye davet edildi",
  "invitation.revoked": "Davet iptal edildi",
  "invitation.accepted": "Davet kabul edildi",
  "member.role_changed": "Üye rolü değiştirildi",
  "member.removed": "Üye kaldırıldı",
  "member.left": "Üye ayrıldı",
};

export default async function AuditLogPage() {
  const context = (await getOrgContext())!;
  const result = await listOrgAudit(orgDeps(), context.actor!, { limit: 100 });

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Denetim kaydı" />
        <EmptyState
          icon={<ScrollText className="size-6" aria-hidden="true" />}
          title="Bu sayfayı görüntüleme yetkiniz yok."
          description="Denetim kaydını yalnızca yöneticiler ve sahipler görebilir."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Denetim kaydı"
        description="Organizasyonunuzdaki kritik işlemlerin değiştirilemez kaydı."
      />
      {result.entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-6" aria-hidden="true" />}
          title="Henüz kayıt yok."
          description="Kritik işlemler yapıldıkça burada görünür."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b bg-surface-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Zaman
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  İşlem
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  IP
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">
                    {e.createdAt.toLocaleString("tr-TR")}
                  </td>
                  <td className="px-4 py-2">{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
