"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

/**
 * List sunset: people who were mailed 3+ times recently and reacted to none are the main source of spam-trap and
 * reputation risk. Retiring them protects the sender, costs nothing (cleaned contacts do not count toward the plan) and
 * is fully reversible.
 */
export function ListCleanup({
  candidates,
  cleaned,
  canWrite,
}: {
  candidates: number;
  cleaned: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(action: "clean" | "restore") {
    setError(null);
    const r = await apiCall("/api/deliverability/cleanup", "POST", { action });
    if (!r.ok) return setError(r.message);
    const d = r.data as { cleaned?: number; restored?: number; limited?: boolean };
    setNotice(
      action === "clean"
        ? `${d.cleaned} kişi gönderimden çıkarıldı.`
        : `${d.restored} kişi geri alındı${d.limited ? " (plan limitinize ulaşıldı)" : ""}.`,
    );
    router.refresh();
  }
  return (
    <section
      aria-labelledby="cleanup"
      className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
    >
      <h2 id="cleanup" className="text-lg font-semibold">
        Liste temizliği
      </h2>
      <p className="text-sm text-muted-foreground">
        Son 90 günde en az 3 e-posta alıp hiçbirine tepki vermeyen (açmayan, tıklamayan)
        kişiler itibarınız için en büyük risktir: spam tuzağına dönüşebilirler. Onları
        gönderimden çıkarmak teslim edilebilirliği korur ve plan kişi sayınıza{" "}
        <strong>sayılmaz</strong>. Hiçbir şey silinmez; istediğiniz zaman geri
        alabilirsiniz.
      </p>
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm font-medium">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          <strong className="text-lg">{candidates.toLocaleString("tr-TR")}</strong>{" "}
          etkisiz kişi
        </span>
        <span>
          <strong className="text-lg">{cleaned.toLocaleString("tr-TR")}</strong>{" "}
          temizlenmiş kişi
        </span>
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <ConfirmDialog
            trigger={
              <Button variant="secondary" disabled={candidates === 0}>
                Etkisizleri gönderimden çıkar
              </Button>
            }
            title="Etkisiz kişiler gönderimden çıkarılsın mı?"
            description={`${candidates} kişi “temizlenmiş” olur ve kampanyalara dahil edilmez. Silinmezler ve istediğiniz zaman geri alabilirsiniz.`}
            confirmLabel="Gönderimden çıkar"
            onConfirm={() => run("clean")}
          />
          <Button
            variant="ghost"
            disabled={cleaned === 0}
            onClick={() => run("restore")}
          >
            Temizlenenleri geri al
          </Button>
        </div>
      ) : null}
    </section>
  );
}
