import { notFound } from "next/navigation";
import { Badge, Table, TableContainer, TBody, TD, TH, THead } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import { PublishForm, UnpublishButton } from "@/components/partner/hub-controls";
import { BackLink } from "@/components/platform/admin-forms";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { listHubFor } from "@/lib/partner/service";
import { templateDeps } from "@/lib/templates/deps";
import { listTemplatesFor } from "@/lib/templates/service";

export const metadata = { title: "Şablon Merkezi" };
export const dynamic = "force-dynamic";

export default async function HubAdminPage() {
  const actor = (await getOrgContext())!.actor!;
  const hub = await listHubFor(orgDeps(), actor);
  if (!hub.ok) notFound();
  const mine = await listTemplatesFor(templateDeps(), actor);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <BackLink href="/partner">Partner paneli</BackLink>
      <PageHeader
        title="Şablon Merkezi"
        description="Sponsorlu girişimcilerin kendi çalışma alanlarına kopyalayabileceği şablonlar. Yalnızca şablon içeriği paylaşılır."
      />
      <PublishForm
        templates={
          mine.ok ? mine.templates.map((t) => ({ id: t.id, name: t.name })) : []
        }
      />
      {hub.templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz yayınlanmış şablon yok.</p>
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Şablon</TH>
                <TH>Kategori</TH>
                <TH>Yayın tarihi</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {hub.templates.map((t) => (
                <tr key={t.id}>
                  <TD className="font-medium">
                    {t.name}
                    {t.description ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        {t.description}
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge>{t.category}</Badge>
                  </TD>
                  <TD>{t.createdAt.toLocaleDateString("tr-TR")}</TD>
                  <TD>
                    <UnpublishButton id={t.id} />
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
