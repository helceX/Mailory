import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { ContactForm } from "@/components/audience/contact-form";
import { audienceDeps } from "@/lib/audience/deps";
import { getContactDetail, getFields } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Kişi" };
export const dynamic = "force-dynamic";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = (await getOrgContext())!.actor!;
  const deps = audienceDeps();
  const [detail, fields] = await Promise.all([
    getContactDetail(deps, actor, id),
    getFields(deps, actor),
  ]);
  if (!detail.ok) notFound(); // another tenant's id looks exactly like a missing one
  const c = detail.contact;
  return (
    <>
      <PageHeader
        title={[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
        description={c.email}
      />
      <ContactForm
        canWrite={can(actor.role, "contacts:write")}
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
        initial={{
          id: c.id,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
          position: c.position,
          website: c.website,
          phone: c.phone,
          sector: c.sector,
          city: c.city,
          status: c.status,
          consentStatus: c.consentStatus,
          consentSource: c.consentSource,
          consentAt: c.consentAt?.toISOString() ?? null,
          unsubscribedAt: c.unsubscribedAt?.toISOString() ?? null,
          custom: c.custom,
          tags: c.tags,
          lists: c.lists,
        }}
      />
    </>
  );
}
