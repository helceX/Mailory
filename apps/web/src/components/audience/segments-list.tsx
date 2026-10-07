"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "./labels";

type Row = { id: string; name: string; lastCount: number | null; updatedAt: string };

export function SegmentsList({
  segments,
  canWrite,
}: {
  segments: Row[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <TableContainer>
        <Table className="min-w-[560px]">
          <THead>
            <tr>
              <TH>Segment</TH>
              <TH>Kişi sayısı</TH>
              <TH>Güncellendi</TH>
              <TH>
                <span className="sr-only">İşlemler</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {segments.map((s) => (
              <tr key={s.id}>
                <TD className="font-medium">{s.name}</TD>
                <TD className="tabular-nums">
                  <Link
                    href={`/audience/contacts?segmentId=${s.id}`}
                    className="text-primary hover:underline"
                  >
                    {s.lastCount === null
                      ? "Görüntüle"
                      : `${s.lastCount.toLocaleString("tr-TR")} kişi`}
                  </Link>
                </TD>
                <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {new Date(s.updatedAt).toLocaleDateString("tr-TR")}
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/audience/segments/${s.id}`}>
                        {canWrite ? "Düzenle" : "Görüntüle"}
                      </Link>
                    </Button>
                    {canWrite ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Sil
                          </Button>
                        }
                        title={`“${s.name}” silinsin mi?`}
                        description="Segment silinir; içindeki kişiler silinmez. Bu segmenti kullanan kampanya taslakları hedef kitlesini kaybeder."
                        confirmLabel="Segmenti sil"
                        onConfirm={async () => {
                          const result = await apiCall(
                            `/api/segments/${s.id}`,
                            "DELETE",
                          );
                          if (!result.ok) setError(result.message);
                          router.refresh();
                        }}
                      />
                    ) : null}
                  </div>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
