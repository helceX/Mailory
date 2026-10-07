import Link from "next/link";
import { notFound } from "next/navigation";
import { PLAN_LABELS, type PlanKey } from "@mailory/core";
import { Badge, Table, TableContainer, TBody, TD, TH, THead } from "@mailory/ui";
import { fmtNum } from "@/components/analytics/kpi";
import { PageHeader } from "@/components/page-header";
import { CreateOrgForm } from "@/components/platform/admin-forms";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { listChildrenFor } from "@/lib/partner/service";

export const metadata = { title: "Partner paneli" };
export const dynamic = "force-dynamic";

export default async function PartnerPage() {
  const actor = (await getOrgContext())!.actor!;
  const r = await listChildrenFor(orgDeps(), actor);
  if (!r.ok) notFound();
  const steps = (c: (typeof r.children)[number]) =>
    [c.domainVerified, c.hasTemplate, c.contacts > 0, c.hasSent].filter(Boolean).length;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Partner paneli"
        description="Sponsorlu girişimci çalışma alanları. Yalnızca durum ve kullanım görürsünüz; kişi listesi, kampanya içeriği ve raporlar görünmez."
        actions={
          <Link
            href="/partner/templates"
            className="text-sm text-primary hover:underline"
          >
            Şablon Merkezi
          </Link>
        }
      />
      <CreateOrgForm
        endpoint="/api/partner/children"
        title="Girişimci ekle"
        hint="Çalışma alanı sahibi bu kişi olur; davet e-postası gider. Siz üye olmazsınız."
        submit="Çalışma alanı aç"
      />
      {r.children.length === 0 ? (
        <p className="rounded-lg border bg-surface p-6 text-sm text-muted-foreground">
          Henüz sponsorlu çalışma alanı yok. Yukarıdan ilk girişimciyi ekleyin.
        </p>
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Girişimci</TH>
                <TH>Plan</TH>
                <TH>Kurulum</TH>
                <TH>Kişi</TH>
                <TH>Bu ay gönderilen</TH>
                <TH>Son gönderim</TH>
                <TH>Durum</TH>
              </tr>
            </THead>
            <TBody>
              {r.children.map((c) => (
                <tr key={c.id}>
                  <TD>
                    <Link
                      href={`/partner/children/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.members === 0 ? (
                      <div className="text-xs text-warning-text">Davet bekliyor</div>
                    ) : null}
                  </TD>
                  <TD>{PLAN_LABELS[c.planKey as PlanKey] ?? c.planKey}</TD>
                  <TD>{steps(c)}/4</TD>
                  <TD>{fmtNum(c.contacts)}</TD>
                  <TD>{fmtNum(c.sentThisMonth)}</TD>
                  <TD>
                    {c.lastSentAt ? c.lastSentAt.toLocaleDateString("tr-TR") : "—"}
                  </TD>
                  <TD>
                    {c.suspendedAt ? (
                      <Badge tone="danger">Askıda</Badge>
                    ) : (
                      <Badge tone="success">Etkin</Badge>
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
      <p className="text-xs text-muted-foreground">
        Kurulum: alan adı doğrulandı · şablon var · kişi eklendi · ilk kampanya
        gönderildi.
      </p>
    </div>
  );
}
