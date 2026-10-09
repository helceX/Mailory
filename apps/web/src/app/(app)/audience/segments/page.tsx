import Link from "next/link";
import { Filter, Plus } from "lucide-react";
import { can } from "@mailory/core";
import { Button, EmptyState } from "@mailory/ui";
import { PageHeader } from "@/components/page-header";
import { SegmentsList } from "@/components/audience/segments-list";
import { audienceDeps } from "@/lib/audience/deps";
import { getSegments } from "@/lib/audience/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Segmentler" };
export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const actor = (await getOrgContext())!.actor!;
  const canWrite = can(actor.role, "contacts:write");
  const result = await getSegments(audienceDeps(), actor);
  const segments = result.ok ? result.segments : [];
  return (
    <>
      <PageHeader
        title="Segmentler"
        description="Koşullara göre kendiliğinden güncellenen dinamik kişi grupları."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/audience/segments/new">
                <Plus aria-hidden="true" /> Yeni segment
              </Link>
            </Button>
          ) : undefined
        }
      />
      {segments.length === 0 ? (
        <EmptyState
          icon={<Filter className="size-6" aria-hidden="true" />}
          title="Henüz segmentiniz bulunmuyor."
          description="Örneğin “Ankara'daki teknoloji girişimleri” gibi bir koşul tanımlayın; yeni kişiler koşula uydukça gruba otomatik girer."
          action={
            canWrite ? (
              <Button asChild>
                <Link href="/audience/segments/new">
                  <Plus aria-hidden="true" /> Yeni segment
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SegmentsList
          segments={segments.map((s) => ({
            id: s.id,
            name: s.name,
            lastCount: s.lastCount,
            updatedAt: s.updatedAt.toISOString(),
          }))}
          canWrite={canWrite}
        />
      )}
    </>
  );
}
