import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { BrandKitForm } from "@/components/templates/brand-kit-form";
import { getOrgContext } from "@/lib/org/context";
import { templateDeps } from "@/lib/templates/deps";
import { getBrandKit } from "@/lib/templates/service";

export const metadata = { title: "Marka kiti" };
export const dynamic = "force-dynamic";

export default async function BrandKitPage() {
  const actor = (await getOrgContext())!.actor!;
  const result = await getBrandKit(templateDeps(), actor);
  if (!result.ok) return null;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Marka kiti"
        description="Logonuzu, renklerinizi ve alt bilginizi bir kez tanımlayın; her yeni e-posta bu kimlikle başlasın."
      />
      <BrandKitForm
        initial={result.brand}
        configured={result.configured}
        canWrite={can(actor.role, "brand:manage")}
      />
    </div>
  );
}
