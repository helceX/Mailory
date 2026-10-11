"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
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
import { apiCall } from "../audience/labels";
import { CopyButton } from "./copy-button";
import { DOMAIN_STATUS, RECORD_STATE, type RecordResultView } from "./labels";

type RecordView = {
  key: string;
  required: boolean;
  type: string;
  host: string;
  hostShort: string;
  value: string;
  title: string;
  explain: string;
};
type Domain = {
  id: string;
  domain: string;
  status: string;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  lastError: string | null;
  failingSince: string | null;
};

export function DomainDetail({
  domain,
  records,
  results,
}: {
  domain: Domain;
  records: RecordView[];
  results: RecordResultView[];
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const status = DOMAIN_STATUS[domain.status] ?? {
    label: domain.status,
    tone: "neutral" as const,
  };
  const byKey = new Map(results.map((r) => [r.key, r]));

  async function check() {
    setChecking(true);
    setError(null);
    setVerdict(null);
    const result = await apiCall(`/api/sender-domains/${domain.id}/check`, "POST");
    setChecking(false);
    if (!result.ok) return setError(result.message);
    const data = result.data as {
      status: string;
      becameVerified: boolean;
      claimedElsewhere: boolean;
      inconclusive: boolean;
    };
    if (data.claimedElsewhere)
      setVerdict(
        "Kayıtlarınız doğru, ancak bu alan adı başka bir çalışma alanında zaten doğrulanmış. Alan adının sahibi sizseniz destek ekibiyle iletişime geçin.",
      );
    else if (data.inconclusive)
      setVerdict(
        "DNS sorgusu şu an yanıt vermedi. Bu bir hata değildir; birkaç dakika sonra tekrar kontrol edin.",
      );
    else if (data.becameVerified) setVerdict("Tebrikler! Alan adınız doğrulandı.");
    else if (data.status !== "verified")
      setVerdict(
        "Henüz tüm zorunlu kayıtlar bulunamadı. DNS değişikliklerinin yayılması birkaç dakikadan 48 saate kadar sürebilir.",
      );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-sm text-muted-foreground">
            {domain.lastCheckedAt
              ? `Son kontrol: ${new Date(domain.lastCheckedAt).toLocaleString("tr-TR")}`
              : "Henüz kontrol edilmedi"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button onClick={check} disabled={checking}>
            {checking ? "Kontrol ediliyor…" : "Şimdi kontrol et"}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="text-danger">
                Alan adını kaldır
              </Button>
            }
            title={`${domain.domain} kaldırılsın mı?`}
            description="Bu alan adındaki gönderici adresleri kullanılamaz hale gelir (silinmezler). Daha sonra yeniden ekleyip doğrulayabilirsiniz."
            confirmLabel="Kaldır"
            onConfirm={async () => {
              const result = await apiCall(
                `/api/sender-domains/${domain.id}`,
                "DELETE",
              );
              if (result.ok) router.replace("/settings/domains");
              else setError(result.message);
            }}
          />
        </div>
      </div>

      <FormError message={error} />
      {verdict ? (
        <p role="status" className="rounded border bg-surface-muted px-3 py-2 text-sm">
          {verdict}
        </p>
      ) : null}
      {domain.lastError === "claimed_elsewhere" ? (
        <p
          role="alert"
          className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-text"
        >
          Bu alan adı başka bir çalışma alanında doğrulanmış olduğundan burada
          doğrulanamıyor. Alan adının sahibi sizseniz destek ekibiyle iletişime geçin.
        </p>
      ) : null}
      {domain.status === "verified" && domain.failingSince ? (
        <p
          role="alert"
          className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-text"
        >
          DNS kayıtlarınızdan bazıları şu an bulunamıyor. Bir saat içinde düzelmezse bu
          alan adından gönderim durdurulacak. Kayıtları aşağıdaki değerlerle kontrol
          edin.
        </p>
      ) : null}
      {domain.status === "verified" && !domain.failingSince ? (
        <p
          role="status"
          className="rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
        >
          Alan adınız doğrulandı. Bu alan adındaki (ve alt alan adlarındaki) gönderici
          adreslerinden kampanya gönderebilirsiniz.
        </p>
      ) : null}

      <section aria-labelledby="how" className="rounded-lg border bg-surface p-4">
        <h2 id="how" className="text-sm font-semibold">
          Nasıl yapılır?
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Alan adınızı satın aldığınız firmanın (ör. GoDaddy, Natro, Turhost,
            Cloudflare) <strong className="text-foreground">DNS yönetim</strong>{" "}
            sayfasını açın.
          </li>
          <li>
            Aşağıdaki her kayıt için yeni bir kayıt ekleyin:{" "}
            <strong className="text-foreground">Tür</strong>,{" "}
            <strong className="text-foreground">Ad (Host)</strong> ve{" "}
            <strong className="text-foreground">Değer</strong> alanlarını kopyalayın.
          </li>
          <li>
            Kaydedin ve bekleyin. Değişikliklerin yayılması birkaç dakikadan 48 saate
            kadar sürebilir. Biz de bunu otomatik olarak kontrol ederiz.
          </li>
          <li>“Şimdi kontrol et” düğmesine basarak sonucu görün.</li>
        </ol>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Sık karşılaşılan sorunlar
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Ad (Host) alanı:</strong> Birçok panel
              alan adını kendisi ekler. Böyle bir panelde “kısa ad” sütunundaki değeri
              kullanın; aksi halde kayıt{" "}
              <code>
                …{domain.domain}.{domain.domain}
              </code>{" "}
              olur.
            </li>
            <li>
              <strong className="text-foreground">Cloudflare:</strong> CNAME
              kayıtlarında “Proxy” (turuncu bulut) kapalı olmalı (“Yalnızca DNS”).
            </li>
            <li>
              <strong className="text-foreground">SPF zaten varsa:</strong> İkinci bir
              SPF kaydı eklemeyin; mevcut kayda <code>include:amazonses.com</code>{" "}
              ifadesini ekleyin. İki SPF kaydı, ikisini de geçersiz kılar.
            </li>
            <li>
              <strong className="text-foreground">Değer sonuna nokta:</strong> Bazı
              paneller CNAME değerinin sonuna otomatik nokta ekler; bu sorun değildir.
            </li>
          </ul>
        </details>
      </section>

      <TableContainer>
        <Table className="min-w-[860px]">
          <THead>
            <tr>
              <TH>Kayıt</TH>
              <TH>Tür</TH>
              <TH>Ad (Host)</TH>
              <TH>Değer</TH>
              <TH>Durum</TH>
            </tr>
          </THead>
          <TBody>
            {records.map((r) => {
              const result = byKey.get(r.key);
              const state = result
                ? (RECORD_STATE[result.state] ?? {
                    label: result.state,
                    tone: "neutral" as const,
                  })
                : null;
              return (
                <tr key={r.key} className="align-top">
                  <TD className="max-w-[220px]">
                    <div className="font-medium">{r.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.required ? "Zorunlu" : "Önerilen"} · {r.explain}
                    </div>
                  </TD>
                  <TD>
                    <code className="text-xs">{r.type}</code>
                  </TD>
                  <TD className="max-w-[240px]">
                    <div className="flex items-start gap-1">
                      <code className="break-all text-xs">{r.host}</code>
                      <CopyButton value={r.host} label={`${r.title} adı`} />
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      Kısa ad: <code className="break-all">{r.hostShort}</code>
                      <CopyButton value={r.hostShort} label={`${r.title} kısa adı`} />
                    </div>
                  </TD>
                  <TD className="max-w-[260px]">
                    <div className="flex items-start gap-1">
                      <code className="break-all text-xs">{r.value}</code>
                      <CopyButton value={r.value} label={`${r.title} değeri`} />
                    </div>
                  </TD>
                  <TD className="max-w-[240px]">
                    {state ? (
                      <Badge tone={state.tone}>{state.label}</Badge>
                    ) : (
                      <Badge>Henüz kontrol edilmedi</Badge>
                    )}
                    {result && result.state !== "ok" ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result.message}
                      </p>
                    ) : null}
                    {result && result.state === "mismatch" && result.found.length ? (
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        Bulunan: <code>{result.found[0]}</code>
                      </p>
                    ) : null}
                  </TD>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
