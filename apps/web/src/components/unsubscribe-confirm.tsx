"use client";

import { useState } from "react";
import { Button } from "@mailory/ui";

export function UnsubscribeConfirm({
  token,
  orgName,
  maskedEmail,
}: {
  token: string;
  orgName: string;
  maskedEmail: string;
}) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  if (state === "done")
    return (
      <div role="status" className="rounded-lg border bg-surface p-6">
        <h1 className="text-lg font-semibold">Abonelikten çıktınız</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {maskedEmail} adresine {orgName ? `${orgName} tarafından ` : ""}artık e-posta
          gönderilmeyecek.
        </p>
      </div>
    );
  return (
    <div className="rounded-lg border bg-surface p-6">
      <h1 className="text-lg font-semibold">Abonelikten çık</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {maskedEmail} adresi {orgName ? `${orgName} ` : ""}e-postalarından çıkarılsın
        mı?
      </p>
      {state === "error" ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          İşlem tamamlanamadı. Lütfen tekrar deneyin.
        </p>
      ) : null}
      <Button
        className="mt-4"
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          try {
            const res = await fetch(`/api/unsubscribe/${encodeURIComponent(token)}`, {
              method: "POST",
            });
            setState(res.ok ? "done" : "error");
          } catch {
            setState("error");
          }
        }}
      >
        {state === "pending" ? "İşleniyor…" : "Evet, abonelikten çık"}
      </Button>
    </div>
  );
}
