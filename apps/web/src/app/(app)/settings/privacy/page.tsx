import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { DeleteOrganization } from "@/components/privacy/privacy-actions";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/org/context";
import { getOrganization } from "@mailory/db";

export const metadata = { title: "Veri ve gizlilik" };
export const dynamic = "force-dynamic";

const RETENTION = [
  ["Açılma/tıklama kayıtları", "25 ay (bot kayıtları 30 gün)"],
  ["Sağlayıcı olayları (teslim/geri dönme)", "13 ay"],
  ["Yapay zekâ kullanım kayıtları", "13 ay"],
  ["Sistem e-postaları (doğrulama, sıfırlama)", "30 gün"],
  ["Süresi dolmuş oturumlar ve tek kullanımlık bağlantılar", "30 gün"],
  ["Silinen çalışma alanı", "30 gün sonra kalıcı silinir"],
  ["Denetim kayıtları", "Silinmez (kişisel veri içermez; kişiler kimlikle anılır)"],
] as const;

export default async function PrivacyPage() {
  const context = (await getOrgContext())!;
  const actor = context.actor!;
  const org = await getOrganization(getDb().db, actor.organizationId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Veri ve gizlilik"
        description="Verilerinizin ne kadar süre saklandığı ve çalışma alanını kapatma."
      />
      <section className="rounded-lg border bg-surface p-4">
        <h2 className="text-sm font-semibold">Saklama süreleri</h2>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {RETENTION.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-3 border-b py-1 last:border-0"
            >
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Kişi bazında erişim (veri indirme) ve silme işlemleri, her kişinin
          sayfasındaki “Kişisel veri hakları” bölümündedir.
        </p>
      </section>
      {can(actor.role, "org:delete") && org ? (
        <DeleteOrganization name={org.name} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Çalışma alanını yalnızca sahip silebilir.
        </p>
      )}
    </div>
  );
}
