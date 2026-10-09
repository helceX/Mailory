import { PageHeader } from "@/components/page-header";
import { BillingProfileForm } from "@/components/billing/billing-profile-form";
import { getBillingProfileFor } from "@/lib/billing/profile";
import { getDb } from "@/lib/db";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Fatura bilgileri" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const actor = (await getOrgContext())!.actor!;
  const r = await getBillingProfileFor({ db: getDb().db }, actor);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fatura bilgileri"
        description="Faturalarınızda görünecek şirket bilgileri. Ücretli plana geçmeden önce gereklidir."
      />
      {r.ok ? (
        <BillingProfileForm profile={r.profile} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Fatura bilgilerini yalnızca çalışma alanı sahibi görebilir ve düzenleyebilir.
        </p>
      )}
    </div>
  );
}
