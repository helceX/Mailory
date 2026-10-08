import { walkBlocks, type EmailDoc } from "./email-doc";

/**
 * Rule-based deliverability review. Deterministic and explainable on purpose: every finding says what is wrong and how
 * to fix it. It estimates risk; it does not promise inbox placement (that depends on reputation we cannot see).
 */
export type Severity = "critical" | "warning" | "info";
export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  fix: string;
};

const WEIGHT: Record<Severity, number> = { critical: 30, warning: 10, info: 2 };

export function scoreFindings(findings: Finding[]): number {
  return Math.max(0, 100 - findings.reduce((a, f) => a + WEIGHT[f.severity], 0));
}
export type HealthBand = "good" | "attention" | "risky";
export const healthBand = (score: number): HealthBand =>
  score >= 85 ? "good" : score >= 60 ? "attention" : "risky";
export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  good: "İyi",
  attention: "Dikkat",
  risky: "Riskli",
};

const SPAM_PHRASES = [
  "ücretsiz",
  "bedava",
  "hemen tıkla",
  "şimdi tıkla",
  "son fırsat",
  "kaçırma",
  "tıkla kazan",
  "para kazan",
  "kazandınız",
  "%100 garanti",
  "100% garanti",
  "risk yok",
  "sınırlı süre",
  "acil",
  "hemen satın al",
  "free",
  "winner",
  "act now",
  "click here",
  "buy now",
  "limited time",
  "100% free",
  "guarantee",
  "make money",
  "earn money",
  "no obligation",
  "urgent",
  "congratulations",
];
const SHORTENERS =
  /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rb\.gy|shorturl\.at)\//i;

export function spamPhraseHits(text: string): string[] {
  const lower = text.toLocaleLowerCase("tr-TR");
  return SPAM_PHRASES.filter((p) => lower.includes(p));
}

function letters(s: string) {
  return [...s].filter(
    (c) => c.toLocaleLowerCase("tr-TR") !== c.toLocaleUpperCase("tr-TR"),
  );
}

export function reviewSubject(subject: string): Finding[] {
  const out: Finding[] = [];
  const s = subject.trim();
  if (!s) return out; // emptiness is a readiness blocker, not a health finding
  const ls = letters(s);
  if (
    ls.length >= 8 &&
    ls.filter((c) => c === c.toLocaleUpperCase("tr-TR")).length / ls.length > 0.6
  )
    out.push({
      code: "subject_caps",
      severity: "warning",
      message: "Konu satırı çoğunlukla BÜYÜK HARF.",
      fix: "Normal cümle düzeniyle yazın; büyük harf spam filtrelerini tetikler.",
    });
  if (/[!?]{2,}|\${2,}/.test(s) || (s.match(/!/g)?.length ?? 0) > 1)
    out.push({
      code: "subject_punct",
      severity: "warning",
      message: "Konuda fazla ünlem/soru işareti var.",
      fix: "En fazla bir ünlem kullanın.",
    });
  const hits = spamPhraseHits(s);
  if (hits.length > 0)
    out.push({
      code: "subject_spam_words",
      severity: "warning",
      message: `Konuda spam filtrelerinin sevdiği ifadeler var: ${hits.slice(0, 4).join(", ")}.`,
      fix: "Daha somut ve doğal bir ifade seçin.",
    });
  if (s.length > 78)
    out.push({
      code: "subject_long",
      severity: "info",
      message: "Konu 78 karakterden uzun; birçok istemcide kesilir.",
      fix: "Önemli kısmı başa alın, 50-60 karakteri hedefleyin.",
    });
  if (s.length < 8)
    out.push({
      code: "subject_short",
      severity: "info",
      message: "Konu çok kısa.",
      fix: "Okuyucuya ne vaat ettiğinizi açıkça yazın.",
    });
  if ((s.match(/\p{Extended_Pictographic}/gu)?.length ?? 0) > 2)
    out.push({
      code: "subject_emoji",
      severity: "info",
      message: "Konuda 2'den fazla emoji var.",
      fix: "Emojiyi azaltın.",
    });
  return out;
}

export type ContentInput = {
  subject: string;
  preheader: string;
  doc: EmailDoc | null;
  hasUnsubscribe: boolean;
};

export function reviewContent(input: ContentInput): Finding[] {
  const out = reviewSubject(input.subject);
  const doc = input.doc;
  if (!doc) return out;
  let textChars = 0;
  let images = 0;
  let missingAlt = 0;
  let links = 0;
  let htmlBlocks = 0;
  let shortened = 0;
  const allText: string[] = [];
  const urls: string[] = [];
  if (doc.raw) {
    // An imported HTML email: judge it by what a recipient would see.
    const html = doc.raw.html;
    const text = html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    textChars += text.length;
    allText.push(text);
    htmlBlocks++;
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      images++;
      if (!/\balt\s*=\s*["'][^"']*\S[^"']*["']/i.test(m[0])) missingAlt++;
    }
    for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi))
      urls.push(m[1]!);
  }
  walkBlocks(doc, (b) => {
    switch (b.type) {
      case "heading":
      case "paragraph":
      case "quote":
        textChars += b.text.length;
        allText.push(b.text);
        break;
      case "image":
        images++;
        if (!b.alt.trim()) missingAlt++;
        if (b.href) urls.push(b.href);
        break;
      case "button":
        urls.push(b.href);
        break;
      case "html":
        htmlBlocks++;
        textChars += b.html.replace(/<[^>]*>/g, "").length;
        break;
      case "social":
        for (const l of b.links) urls.push(l.url);
        break;
      default:
    }
  });
  for (const m of allText.join(" ").matchAll(/https?:\/\/\S+/g)) urls.push(m[0]);
  for (const u of urls) {
    if (/^https?:\/\//i.test(u)) {
      links++;
      if (SHORTENERS.test(u)) shortened++;
    }
  }
  if (images > 0 && textChars < 200)
    out.push({
      code: "image_heavy",
      severity: "warning",
      message: "İçerik görsel ağırlıklı, metin çok az.",
      fix: "En az birkaç cümle gerçek metin ekleyin; yalnızca görselden oluşan e-postalar spam sayılır.",
    });
  else if (textChars < 40)
    out.push({
      code: "thin_content",
      severity: "warning",
      message: "E-postada neredeyse hiç metin yok.",
      fix: "Mesajınızı kısa bir metinle açıklayın.",
    });
  if (missingAlt > 0)
    out.push({
      code: "image_alt",
      severity: "info",
      message: `${missingAlt} görselde alternatif metin yok.`,
      fix: "Görsel engellendiğinde görünecek kısa bir açıklama ekleyin.",
    });
  if (links > 10)
    out.push({
      code: "many_links",
      severity: "warning",
      message: `E-postada ${links} bağlantı var.`,
      fix: "Bağlantı sayısını azaltın; tek bir net çağrıya odaklanın.",
    });
  if (shortened > 0)
    out.push({
      code: "url_shortener",
      severity: "warning",
      message: "Kısaltılmış bağlantılar (bit.ly vb.) kullanılıyor.",
      fix: "Gerçek alan adınızı gösteren tam bağlantıları kullanın; kısaltıcılar spam filtrelerince kötü itibarlıdır.",
    });
  const bodyHits = spamPhraseHits(allText.join(" "));
  if (bodyHits.length >= 3)
    out.push({
      code: "body_spam_words",
      severity: "warning",
      message: `Metinde birden çok spam ifadesi var: ${bodyHits.slice(0, 4).join(", ")}.`,
      fix: "Satış baskısı dilini azaltın.",
    });
  if (htmlBlocks > 0)
    out.push({
      code: "custom_html",
      severity: "info",
      message: "Özel HTML bloğu kullanılıyor.",
      fix: "Özel HTML istemcilerde farklı görünebilir; birkaç istemcide test edin.",
    });
  if (!input.preheader.trim() && !doc.settings.preheader.trim())
    out.push({
      code: "no_preheader",
      severity: "info",
      message: "Ön izleme metni yok.",
      fix: "Gelen kutusunda konunun yanında görünen kısa bir özet ekleyin.",
    });
  if (!input.hasUnsubscribe)
    out.push({
      code: "no_unsubscribe",
      severity: "critical",
      message: "Abonelikten çıkma bağlantısı yok.",
      fix: "Alt bilgi bloğunda 'Abonelikten çık' bağlantısını açın (zorunlu).",
    });
  return out;
}

export type SenderAuth = {
  verified: boolean;
  spfState?: string | null;
  dmarcState?: string | null;
};

/** Gmail/Yahoo bulk-sender rules: SPF + DKIM + DMARC and one-click unsubscribe. */
export function reviewSender(auth: SenderAuth | null): Finding[] {
  if (!auth || !auth.verified)
    return [
      {
        code: "sender_unverified",
        severity: "critical",
        message: "Gönderici alan adı doğrulanmamış.",
        fix: "Ayarlar → Alan adları'ndan DNS kayıtlarını tamamlayın.",
      },
    ];
  const out: Finding[] = [];
  if (auth.spfState !== "ok" && auth.spfState !== "pass")
    out.push({
      code: "spf_missing",
      severity: "warning",
      message: "SPF kaydı doğrulanmadı.",
      fix: "Alan adı sayfasındaki SPF önerisini ekleyin.",
    });
  if (
    auth.dmarcState !== "ok" &&
    auth.dmarcState !== "pass" &&
    auth.dmarcState !== "present"
  )
    out.push({
      code: "dmarc_missing",
      severity: "warning",
      message: "DMARC kaydı yok.",
      fix: "En az `v=DMARC1; p=none` kaydı ekleyin; Gmail ve Yahoo toplu gönderenlerden DMARC bekler.",
    });
  return out;
}

export type AudienceHealth = {
  size: number;
  cold: number;
  dormant: number;
  scored: number;
};

export function reviewAudience(
  a: AudienceHealth | null,
  dailyLimit: number,
): Finding[] {
  if (!a) return [];
  const out: Finding[] = [];
  if (a.size > dailyLimit)
    out.push({
      code: "over_daily_limit",
      severity: "info",
      message: `Kitle (${a.size}) günlük gönderim sınırını (${dailyLimit}) aşıyor; gönderim birkaç güne yayılır.`,
      fix: "Bu beklenen bir davranış; acele ediyorsanız kitleyi daraltın.",
    });
  if (a.scored >= 50 && (a.cold + a.dormant) / a.scored > 0.4)
    out.push({
      code: "cold_audience",
      severity: "warning",
      message: "Kitlenin büyük kısmı uzun süredir etkileşimde değil.",
      fix: "Önce etkileşimi yüksek kişilere gönderin veya pasif kişileri ayrı bir yeniden etkinleştirme kampanyasına alın.",
    });
  return out;
}

export type RateInput = {
  sent: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
};
export const RATE_LIMITS = {
  minSample: 50,
  bounceWarn: 0.02,
  bounceCritical: 0.05,
  complaintWarn: 0.001,
  complaintCritical: 0.003,
  unsubscribeWarn: 0.01,
} as const;

/** Post-send (or rolling) health from real outcomes. Needs a minimum sample to avoid noisy verdicts. */
export function reviewRates(r: RateInput): Finding[] {
  if (r.sent < RATE_LIMITS.minSample) return [];
  const out: Finding[] = [];
  const b = r.bounced / r.sent;
  const c = r.complained / r.sent;
  const u = r.unsubscribed / r.sent;
  const pct = (v: number) => `%${(v * 100).toFixed(2).replace(".", ",")}`;
  if (b >= RATE_LIMITS.bounceCritical)
    out.push({
      code: "bounce_critical",
      severity: "critical",
      message: `Geri dönme oranı ${pct(b)} — tehlikeli seviye.`,
      fix: "Listeyi doğrulayın, eski/satın alınmış adresleri çıkarın; gönderime ara verin.",
    });
  else if (b >= RATE_LIMITS.bounceWarn)
    out.push({
      code: "bounce_warn",
      severity: "warning",
      message: `Geri dönme oranı ${pct(b)} — yükseliyor.`,
      fix: "Geri dönen adresler otomatik bastırılır; listenizin kaynağını gözden geçirin.",
    });
  if (c >= RATE_LIMITS.complaintCritical)
    out.push({
      code: "complaint_critical",
      severity: "critical",
      message: `Şikayet oranı ${pct(c)} — tehlikeli seviye.`,
      fix: "İzin kayıtlarını ve gönderim sıklığını gözden geçirin; yalnızca izin veren kişilere gönderin.",
    });
  else if (c >= RATE_LIMITS.complaintWarn)
    out.push({
      code: "complaint_warn",
      severity: "warning",
      message: `Şikayet oranı ${pct(c)} — dikkat.`,
      fix: "Beklentiyi netleştirin; abonelikten çık bağlantısını belirgin tutun.",
    });
  if (u >= RATE_LIMITS.unsubscribeWarn)
    out.push({
      code: "unsub_warn",
      severity: "info",
      message: `Abonelikten çıkma oranı ${pct(u)}.`,
      fix: "İçeriğin kitleyle ilgisini ve gönderim sıklığını gözden geçirin.",
    });
  return out;
}

// ---- engagement ------------------------------------------------------------------------------------------------

export type EngagementInput = { sent: number; opened: number; clicked: number };
export type EngagementBand = "new" | "hot" | "warm" | "cold" | "dormant";
export const ENGAGEMENT_LABELS: Record<EngagementBand, string> = {
  new: "Yeni",
  hot: "Çok aktif",
  warm: "Aktif",
  cold: "Soğuk",
  dormant: "Pasif",
};
export const MIN_SENDS_FOR_SCORE = 3;

/**
 * 0–100 over the last 90 days: half open rate, half click rate (clicks count triple, since opens are inflated by mail
 * privacy features). Null until a contact has received enough mail to say anything.
 */
export function engagementScore(e: EngagementInput): number | null {
  if (e.sent < MIN_SENDS_FOR_SCORE) return null;
  const open = Math.min(1, e.opened / e.sent);
  const click = Math.min(1, (e.clicked / e.sent) * 3);
  return Math.round(100 * (0.5 * open + 0.5 * click));
}
export function engagementBand(score: number | null, sent = 0): EngagementBand {
  if (score === null) return "new";
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  if (score > 0 || sent < 5) return "cold";
  return "dormant";
}
