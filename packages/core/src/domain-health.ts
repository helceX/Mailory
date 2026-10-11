import {
  healthBand,
  scoreFindings,
  type Finding,
  type HealthBand,
} from "./deliverability";

/*
 * Free "domain health" analysis (SPF / DKIM / DMARC / MX) for any sending domain. Pure: the caller supplies the DNS data it
 * fetched, so the rules are testable and the result is explainable — every finding says what is wrong, why it matters and
 * exactly what to publish. No external reputation feed is involved.
 */

export type DomainHealthInput = {
  domain: string;
  /** Apex TXT records. */
  txt: string[];
  /** TXT at _dmarc.<domain>. */
  dmarc: string[];
  /** Selectors for which a DKIM TXT/CNAME record was found. */
  dkimSelectors: string[];
  /** Apex MX hosts. */
  mx: string[];
  /** Names that could not be looked up (timeouts). Reported, never treated as "missing". */
  lookupFailures?: string[];
};

export type DomainHealth = {
  domain: string;
  score: number;
  band: HealthBand;
  findings: Finding[];
  /** What we found, for display. */
  facts: {
    spf: string | null;
    dmarc: string | null;
    dkimSelectors: string[];
    mx: string[];
  };
  /** Selectors we probed (DKIM selectors are not discoverable; this is a best-effort list). */
  incomplete: boolean;
};

export const COMMON_DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "selector2",
  "k1",
  "k2",
  "s1",
  "s2",
  "mail",
  "dkim",
  "mandrill",
  "smtp",
  "em",
  "mxvault",
  "zoho",
  "cm",
  "amazonses",
] as const;

const SPF_LOOKUP_MECHANISMS =
  /^(include:|a(:|\/|$)|mx(:|\/|$)|ptr(:|$)|exists:|redirect=)/i;

function analyzeSpf(records: string[], out: Finding[]): string | null {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  if (spf.length === 0) {
    out.push({
      code: "spf_missing",
      severity: "critical",
      message: "SPF kaydı yok.",
      fix: "Alan adınıza bir TXT kaydı ekleyin: v=spf1 include:<gönderim sağlayıcınız> ~all (sağlayıcınız tam değeri verir).",
    });
    return null;
  }
  if (spf.length > 1) {
    out.push({
      code: "spf_multiple",
      severity: "critical",
      message: `${spf.length} ayrı SPF kaydı var; birden fazla SPF kaydı geçersizdir ve hepsi yok sayılır.`,
      fix: "Tüm SPF kayıtlarını tek bir TXT kaydında birleştirin (tek bir v=spf1 …).",
    });
  }
  const record = spf[0]!.trim();
  const terms = record.split(/\s+/).slice(1);
  const lookups = terms.filter((t) =>
    SPF_LOOKUP_MECHANISMS.test(t.replace(/^[+\-~?]/, "")),
  ).length;
  if (lookups > 10)
    out.push({
      code: "spf_lookups",
      severity: "critical",
      message: `SPF kaydında ${lookups} DNS sorgusu gerektiren ifade var; sınır 10, aşılırsa SPF çalışmaz (permerror).`,
      fix: "Gereksiz include/a/mx ifadelerini kaldırın ya da sağlayıcılarınızı tek bir alt alan adında toplayın.",
    });
  else if (lookups >= 8)
    out.push({
      code: "spf_lookups_near",
      severity: "info",
      message: `SPF kaydı ${lookups}/10 DNS sorgusu kullanıyor; yeni bir sağlayıcı eklemek sınırı aşabilir.`,
      fix: "Kullanmadığınız include ifadelerini temizleyin.",
    });
  if (terms.some((t) => /^\+?ptr(:|$)/i.test(t)))
    out.push({
      code: "spf_ptr",
      severity: "warning",
      message: "SPF kaydında kullanımı önerilmeyen 'ptr' ifadesi var.",
      fix: "'ptr' yerine açık ip4/ip6 veya include ifadeleri kullanın.",
    });
  const all = terms.find((t) => /^[+\-~?]?all$/i.test(t));
  if (!all)
    out.push({
      code: "spf_no_all",
      severity: "warning",
      message:
        "SPF kaydı 'all' ile bitmiyor; kayıtta olmayan sunucular için ne yapılacağı belirsiz.",
      fix: "Kaydın sonuna ~all (önerilen) veya -all ekleyin.",
    });
  else if (/^\+all$|^all$/i.test(all))
    out.push({
      code: "spf_plus_all",
      severity: "critical",
      message:
        "SPF kaydı '+all' ile bitiyor: internetteki herkes alan adınız adına e-posta gönderebilir.",
      fix: "'+all' yerine ~all veya -all kullanın.",
    });
  else if (/^\?all$/i.test(all))
    out.push({
      code: "spf_neutral",
      severity: "warning",
      message: "SPF kaydı '?all' ile bitiyor: hiçbir koruma sağlamaz.",
      fix: "'?all' yerine ~all veya -all kullanın.",
    });
  return record;
}

function analyzeDmarc(records: string[], out: Finding[]): string | null {
  const found = records.filter((r) => /^v=DMARC1\s*;?/i.test(r.trim()));
  if (found.length === 0) {
    out.push({
      code: "dmarc_missing",
      severity: "critical",
      message:
        "DMARC kaydı yok. Gmail ve Yahoo toplu gönderenlerden (günde 5.000+ e-posta) DMARC bekler; yokluğu teslimi düşürür.",
      fix: "_dmarc.<alan adınız> adına TXT kaydı ekleyin: v=DMARC1; p=none; rua=mailto:dmarc@<alan adınız> (izlemeyle başlayın).",
    });
    return null;
  }
  if (found.length > 1)
    out.push({
      code: "dmarc_multiple",
      severity: "warning",
      message: "Birden fazla DMARC kaydı var; alıcılar hepsini yok sayabilir.",
      fix: "Tek bir DMARC kaydı bırakın.",
    });
  const record = found[0]!.trim();
  const tags = Object.fromEntries(
    record
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return i < 0
          ? [p.toLowerCase(), ""]
          : [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
      }),
  ) as Record<string, string>;
  const policy = (tags.p ?? "").toLowerCase();
  if (!["none", "quarantine", "reject"].includes(policy))
    out.push({
      code: "dmarc_bad_policy",
      severity: "critical",
      message:
        "DMARC kaydında geçerli bir 'p=' politikası yok; kayıt geçersiz sayılır.",
      fix: "p=none, p=quarantine veya p=reject ekleyin.",
    });
  else if (policy === "none")
    out.push({
      code: "dmarc_monitor_only",
      severity: "warning",
      message:
        "DMARC politikası p=none: yalnızca izliyor, sahte e-postaları engellemiyor.",
      fix: "Raporları (rua) inceleyip sorun görmüyorsanız p=quarantine, sonra p=reject'e geçin.",
    });
  if (!tags.rua)
    out.push({
      code: "dmarc_no_reports",
      severity: "info",
      message:
        "DMARC raporu adresi (rua) yok; kimlerin adınıza gönderdiğini göremezsiniz.",
      fix: "rua=mailto:dmarc@<alan adınız> ekleyin.",
    });
  if (tags.pct && Number(tags.pct) < 100 && policy !== "none")
    out.push({
      code: "dmarc_partial",
      severity: "info",
      message: `DMARC politikası e-postaların yalnızca %${tags.pct}'ine uygulanıyor.`,
      fix: "Sorun görmüyorsanız pct değerini 100'e çıkarın (ya da kaldırın).",
    });
  return record;
}

export function analyzeDomainHealth(input: DomainHealthInput): DomainHealth {
  const out: Finding[] = [];
  const failed = new Set(input.lookupFailures ?? []);
  const spf = failed.has(input.domain) ? null : analyzeSpf(input.txt, out);
  const dmarc = failed.has(`_dmarc.${input.domain}`)
    ? null
    : analyzeDmarc(input.dmarc, out);
  // A name we could not look up is reported as "incomplete", never as "missing".
  if (input.dkimSelectors.length === 0)
    out.push({
      code: "dkim_not_found",
      severity: "warning",
      message:
        "Yaygın DKIM seçicilerinde bir kayıt bulamadık. (DKIM seçicisi dışarıdan bilinemez; özel bir seçici kullanıyor olabilirsiniz.)",
      fix: "Gönderim sağlayıcınızın verdiği DKIM kaydını (<seçici>._domainkey.<alan adınız>) yayınladığınızdan emin olun; Mailory bunu sizin için doğrular.",
    });
  if (input.mx.length === 0 && !failed.has(`mx:${input.domain}`))
    out.push({
      code: "mx_missing",
      severity: "warning",
      message:
        "Alan adının MX kaydı yok: bu adrese e-posta alınamaz; yanıtlar ve geri dönen e-postalar kaybolur, bazı alıcılar bunu şüpheli sayar.",
      fix: "Yanıt alacağınız bir e-posta hizmetinin MX kayıtlarını ekleyin.",
    });
  const score = scoreFindings(out);
  return {
    domain: input.domain,
    score,
    band: healthBand(score),
    findings: out.sort((a, b) => order[a.severity] - order[b.severity]),
    facts: { spf, dmarc, dkimSelectors: input.dkimSelectors, mx: input.mx },
    incomplete: failed.size > 0,
  };
}
const order = { critical: 0, warning: 1, info: 2 } as const;
