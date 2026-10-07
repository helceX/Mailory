import Link from "next/link";
import { Plus, Upload, Users } from "lucide-react";
import { can } from "@mailory/core";
import { contactFilterSchema } from "@mailory/validation";
import { Button, EmptyState } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import { ContactsView } from "@/components/audience/contacts-view";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists, getSegments, getTags, searchContacts } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Kişiler" };
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = (await getOrgContext())!.actor!;
  const deps = audienceDeps();

  const parsed = contactFilterSchema.safeParse(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
  );
  const filter = parsed.success ? parsed.data : {};
  const [page, lists, tags, segments] = await Promise.all([
    searchContacts(deps, actor, { filter, limit: 50 }),
    getLists(deps, actor),
    getTags(deps, actor),
    getSegments(deps, actor),
  ]);
  if (!page.ok || !lists.ok || !tags.ok || !segments.ok)
    return <EmptyState title="Bu sayfayı görüntüleme yetkiniz yok." />;

  const canWrite = can(actor.role, "contacts:write");
  const hasFilter = Object.keys(filter).length > 0;
  const qs = new URLSearchParams(
    Object.entries(filter).map(([k, v]) => [k, String(v)]),
  ).toString();

  return (
    <>
      <PageHeader
        title="Kişiler"
        description={`Toplam ${page.total?.toLocaleString("tr-TR") ?? 0} kişi${hasFilter ? " (filtreli)" : ""}.`}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button asChild variant="secondary">
                <Link href="/audience/contacts/import">
                  <Upload aria-hidden="true" /> İçe aktar
                </Link>
              </Button>
              <Button asChild>
                <Link href="/audience/contacts/new">
                  <Plus aria-hidden="true" /> Kişi ekle
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />
      {page.total === 0 && !hasFilter ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden="true" />}
          title="Henüz kişiniz bulunmuyor."
          description="CSV dosyanızı içe aktararak veya tek tek ekleyerek başlayın. Kampanyalarınız bu kişilere gönderilir."
          action={
            canWrite ? (
              <Button asChild>
                <Link href="/audience/contacts/import">
                  <Upload aria-hidden="true" /> CSV içe aktar
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ContactsView
          key={qs}
          initial={{
            rows: page.rows.map((r) => ({
              id: r.id,
              email: r.email,
              name: [r.firstName, r.lastName].filter(Boolean).join(" "),
              company: r.company,
              status: r.status,
              createdAt: r.createdAt.toISOString(),
              tags: r.tags,
            })),
            nextCursor: page.nextCursor,
            total: page.total ?? 0,
          }}
          filter={filter}
          queryString={qs}
          options={{
            lists: lists.lists.map((l) => ({ id: l.id, name: l.name })),
            tags: tags.tags.map((t) => ({ id: t.id, name: t.name })),
            segments: segments.segments.map((s) => ({ id: s.id, name: s.name })),
          }}
          canWrite={canWrite}
          canExport={can(actor.role, "contacts:export")}
        />
      )}
    </>
  );
}
