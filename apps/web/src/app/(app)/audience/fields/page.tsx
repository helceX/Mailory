import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { FieldsManager } from "@/components/audience/fields-manager";
import { audienceDeps } from "@/lib/audience/deps";
import { getFields } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Özel alanlar" };
export const dynamic = "force-dynamic";

export default async function FieldsPage() {
  const actor = (await getOrgContext())!.actor!;
  const fields = await getFields(audienceDeps(), actor);
  return (
    <>
      <PageHeader
        title="Özel alanlar"
        description="Kişilerinize kendi bilgi alanlarınızı ekleyin; segmentlerde ve kişiselleştirmede kullanılır."
      />
      <FieldsManager
        fields={fields.ok ? fields.fields : []}
        canWrite={can(actor.role, "contacts:write")}
      />
    </>
  );
}
