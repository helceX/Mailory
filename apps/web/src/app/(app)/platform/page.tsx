import Link from "next/link";
import { PLAN_LABELS, type PlanKey } from "@mailory/core";
import { Badge, Table, TableContainer, TBody, TD, TH, THead } from "@mailory/ui";
import { fmtNum } from "@/components/analytics/kpi";
import { PageHeader } from "@/components/page-header";
import { CreateOrgForm } from "@/components/platform/admin-forms";
import { orgDeps } from "@/lib/org/context";
import { requirePlatformAdmin } from "@/lib/platform/page-guard";
import { listOrgsFor } from "@/lib/platform/service";

export const metadata = { title: "Platform" };
export const dynamic = "force-dynamic";

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { q } = await searchParams;
  const r = await listOrgsFor(orgDeps(), admin, q);
  if (!r.ok) return null;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Platform yönetimi"
        description="Tüm çalışma alanları: plan, kullanım, durum. İçerik (kişi, kampanya) burada görünmez."
        actions={
          <Link
            href="/platform/system"
            className="text-sm text-primary hover:underline"
          >
            Sistem durumu
          </Link>
        }
      />
      <CreateOrgForm
        endpoint="/api/platform/partners"
        title="Partner kurum oluştur (ör. BTM)"
        hint="Bu kişi partnerin sahibi olur; davet e-postası gider."
        submit="Partner oluştur"
      />
      <form className="flex gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Ad ara…"
          aria-label="Çalışma alanı ara"
          className="h-10 w-64 rounded border bg-surface px-3 text-sm"
        />
        <button className="rounded border px-3 text-sm">Ara</button>
      </form>
      <TableContainer>
        <Table>
          <THead>
            <tr>
              <TH>Çalışma alanı</TH>
              <TH>Tür</TH>
              <TH>Plan</TH>
              <TH>Üye</TH>
              <TH>Kişi</TH>
              <TH>Bu ay gönderilen</TH>
              <TH>Durum</TH>
            </tr>
          </THead>
          <TBody>
            {r.orgs.map((o) => (
              <tr key={o.id}>
                <TD>
                  <Link
                    href={`/platform/orgs/${o.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {o.name}
                  </Link>
                </TD>
                <TD>
                  {o.type === "partner" ? (
                    <Badge tone="info">Partner</Badge>
                  ) : o.parentOrganizationId ? (
                    "Sponsorlu"
                  ) : (
                    "Standart"
                  )}
                </TD>
                <TD>{PLAN_LABELS[o.planKey as PlanKey] ?? o.planKey}</TD>
                <TD>{o.members}</TD>
                <TD>{fmtNum(o.contacts)}</TD>
                <TD>{fmtNum(o.sentThisMonth)}</TD>
                <TD>{o.suspendedAt ? <Badge tone="danger">Askıda</Badge> : "Etkin"}</TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
