"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge, Button, Input } from "@mailory/ui";

type Finding = {
  code: string;
  severity: "critical" | "warning" | "info";
  message: string;
  fix: string;
};
type Report = {
  domain: string;
  score: number;
  band: "good" | "attention" | "risky";
  findings: Finding[];
  facts: {
    spf: string | null;
    dmarc: string | null;
    dkimSelectors: string[];
    mx: string[];
  };
  incomplete: boolean;
};

const BAND: Record<Report["band"], [string, "success" | "warning" | "danger"]> = {
  good: ["İyi", "success"],
  attention: ["Dikkat", "warning"],
  risky: ["Riskli", "danger"],
};
const SEV: Record<Finding["severity"], [string, "danger" | "warning" | "info"]> = {
  critical: ["Kritik", "danger"],
  warning: ["Uyarı", "warning"],
  info: ["Bilgi", "info"],
};

export function DomainCheckForm() {
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(
        `/api/public/domain-check?domain=${encodeURIComponent(domain)}`,
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error?.message ?? "Kontrol yapılamadı.");
      else setReport(body as Report);
    } catch {
      setError("Kontrol yapılamadı. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
        <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          <label htmlFor="domain" className="text-sm font-medium">
            Alan adınız
          </label>
          <Input
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="sirketim.com"
            autoComplete="off"
            inputMode="url"
          />
        </div>
        <Button type="submit" disabled={busy || domain.trim().length < 4}>
          {busy ? "Kontrol ediliyor…" : "Kontrol et"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {report ? (
        <section aria-live="polite" aria-label="Sonuç" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-4">
            <div>
              <div className="text-xs text-muted-foreground">{report.domain}</div>
              <div className="text-3xl font-extrabold">{report.score}/100</div>
            </div>
            <Badge tone={BAND[report.band][1]}>{BAND[report.band][0]}</Badge>
            {report.incomplete ? (
              <span className="text-xs text-muted-foreground">
                Bazı sorgular zaman aşımına uğradı; sonuç eksik olabilir, birkaç dakika
                sonra tekrar deneyin.
              </span>
            ) : null}
          </div>
          {report.findings.length === 0 ? (
            <p className="rounded-lg border bg-surface p-4 text-sm text-success">
              Temel e-posta kimlik doğrulaması (SPF, DKIM, DMARC, MX) düzgün görünüyor.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.findings.map((f) => (
                <li
                  key={f.code}
                  className="flex flex-wrap items-start gap-3 rounded-lg border bg-surface p-3 text-sm"
                >
                  <Badge tone={SEV[f.severity][1]}>{SEV[f.severity][0]}</Badge>
                  <div className="min-w-[220px] flex-1">
                    <div>{f.message}</div>
                    <div className="text-xs text-muted-foreground">
                      Ne yapmalı: {f.fix}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <dt className="font-medium text-foreground">SPF</dt>
              <dd className="break-all">{report.facts.spf ?? "yok"}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">DMARC</dt>
              <dd className="break-all">{report.facts.dmarc ?? "yok"}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">DKIM (bulunan seçiciler)</dt>
              <dd>{report.facts.dkimSelectors.join(", ") || "bulunamadı"}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">MX</dt>
              <dd className="break-all">{report.facts.mx.join(", ") || "yok"}</dd>
            </div>
          </dl>
          <div className="rounded-lg border bg-surface-muted p-4 text-sm">
            <p className="font-medium">Bunları sizin yerinize izleyelim.</p>
            <p className="mt-1 text-muted-foreground">
              Mailory, alan adınızı sürekli kontrol eder, bozulduğunda sizi uyarır ve
              gönderimleri güvenli şekilde yönetir.
            </p>
            <Button asChild className="mt-3">
              <Link href="/register">Ücretsiz dene</Link>
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
