import { redirect } from "next/navigation";
import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { ContactForm } from "@/components/audience/contact-form";
import { audienceDeps } from "@/lib/audience/deps";
import { getFields } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Kişi ekle" };

export default async function NewContactPage() {
  const actor = (await getOrgContext())!.actor!;
  if (!can(actor.role, "contacts:write")) redirect("/audience/contacts");
  const fields = await getFields(audienceDeps(), actor);
  return (
    <>
      <PageHeader title="Kişi ekle" />
      <ContactForm
        canWrite
        fields={
          fields.ok
            ? fields.fields.map((f) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                options: f.options,
              }))
            : []
        }
      />
    </>
  );
}
