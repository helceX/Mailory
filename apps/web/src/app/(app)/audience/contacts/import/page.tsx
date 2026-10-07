import { redirect } from "next/navigation";
import { can } from "@mailory/core";
import { Table, TableContainer, TBody, TD, TH, THead } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "@/components/audience/import-wizard";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists, getTags, recentImports } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "CSV içe aktar" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const actor = (await getOrgContext())!.actor!;
  if (!can(actor.role, "contacts:write")) redirect("/audience/contacts");
  const deps = audienceDeps();
  const [lists, tags, jobs] = await Promise.all([
    getLists(deps, actor),
    getTags(deps, actor),
    recentImports(deps, actor),
  ]);
  return (
    <>
      <PageHeader
        title="CSV içe aktar"
        description="Mevcut listenizi (ör. SendPulse veya Excel dışa aktarımı) Mailory'ye taşıyın."
      />
      <ImportWizard
        lists={lists.ok ? lists.lists.map((l) => ({ id: l.id, name: l.name })) : []}
        tags={tags.ok ? tags.tags : []}
      />
      {jobs.ok && jobs.jobs.length > 0 ? (
        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <h2 id="recent" className="text-sm font-semibold">
            Son içe aktarımlar
          </h2>
          <TableContainer>
            <Table className="min-w-[560px]">
              <THead>
                <tr>
                  <TH>Tarih</TH>
                  <TH>Dosya</TH>
                  <TH>Eklenen</TH>
                  <TH>Güncellenen</TH>
                  <TH>Atlanan</TH>
                  <TH>Geçersiz</TH>
                </tr>
              </THead>
              <TBody>
                {jobs.jobs.map((j) => (
                  <tr key={j.id}>
                    <TD className="whitespace-nowrap tabular-nums">
                      {j.createdAt.toLocaleString("tr-TR")}
                    </TD>
                    <TD>{j.filename ?? "—"}</TD>
                    <TD className="tabular-nums">
                      {j.inserted.toLocaleString("tr-TR")}
                    </TD>
                    <TD className="tabular-nums">
                      {j.updated.toLocaleString("tr-TR")}
                    </TD>
                    <TD className="tabular-nums">
                      {(j.skipped + j.suppressed).toLocaleString("tr-TR")}
                    </TD>
                    <TD className="tabular-nums">
                      {j.invalid.toLocaleString("tr-TR")}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </section>
      ) : null}
    </>
  );
}
