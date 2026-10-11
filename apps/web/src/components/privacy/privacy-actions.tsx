"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button, ConfirmDialog, Field, Input } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

/** KVKK: access (download) for editors who may export, erasure for admins. */
export function ContactPrivacy({
  id,
  canExport,
  canErase,
}: {
  id: string;
  canExport: boolean;
  canErase: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!canExport && !canErase) return null;
  return (
    <section
      aria-labelledby="kvkk"
      className="mt-6 flex flex-col gap-3 rounded-lg border bg-surface p-4"
    >
      <h2 id="kvkk" className="text-sm font-semibold">
        Kişisel veri hakları (KVKK)
      </h2>
      <p className="text-xs text-muted-foreground">
        Kişi, hakkındaki verilerin bir kopyasını isteyebilir veya silinmesini talep
        edebilir. Silme geri alınamaz: kişi, liste/etiket üyelikleri ve açılma/tıklama
        kayıtları silinir; gönderim kayıtlarındaki adres anonimleştirilir. Abonelikten
        çıkma/geri dönme kaydı, kişiye bir daha e-posta gönderilmemesi için saklanır.
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {canExport ? (
          <Button asChild variant="secondary">
            <a href={`/api/contacts/${id}/export`} download>
              <Download className="size-4" aria-hidden="true" /> Verilerini indir (JSON)
            </a>
          </Button>
        ) : null}
        {canErase ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="text-danger">
                Kalıcı olarak sil
              </Button>
            }
            title="Kişi kalıcı olarak silinsin mi?"
            description="Bu işlem geri alınamaz. Kişinin tüm kayıtları silinir ve gönderim geçmişindeki adresi anonimleştirilir."
            confirmLabel="Kalıcı olarak sil"
            onConfirm={async () => {
              const r = await apiCall(`/api/contacts/${id}/erase`, "POST");
              if (!r.ok) return setError(r.message);
              router.push("/audience/contacts");
              router.refresh();
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

export function DeleteOrganization({ name }: { name: string }) {
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section
      aria-labelledby="del"
      className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-surface p-4"
    >
      <h2 id="del" className="text-sm font-semibold text-danger">
        Çalışma alanını sil
      </h2>
      <p className="text-xs text-muted-foreground">
        Çalışma alanı hemen kapanır, tüm gönderimler durur ve ekip erişimi kesilir.
        Verileriniz <strong>30 gün</strong> saklanır (bu sürede platform yöneticisi geri
        açabilir), sonra kalıcı olarak silinir. Kişi listenizi silmeden önce Kitle
        sayfasından dışa aktarmayı unutmayın.
      </p>
      <FormError message={error} />
      <Field
        id="del-confirm"
        label={`Onaylamak için çalışma alanı adını yazın: ${name}`}
      >
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <div>
        <ConfirmDialog
          trigger={
            <Button
              variant="secondary"
              className="text-danger"
              disabled={busy || !confirm.trim()}
            >
              Çalışma alanını sil
            </Button>
          }
          title="Çalışma alanı silinsin mi?"
          description="Tüm gönderimler durdurulur ve ekip erişimi kapanır. 30 gün sonra veriler kalıcı olarak silinir."
          confirmLabel="Evet, sil"
          onConfirm={async () => {
            setBusy(true);
            const r = await apiCall("/api/org/delete", "POST", {
              confirmName: confirm,
            });
            setBusy(false);
            if (!r.ok) return setError(r.message);
            window.location.href = "/";
          }}
        />
      </div>
    </section>
  );
}
