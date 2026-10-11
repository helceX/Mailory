import type { AudienceHealth, Finding } from "./deliverability";

export type AudiencePlan = {
  standard: number;
  economical: number;
  avoided: number;
  reductionPercent: number;
  unscored: number;
};

/** An audience comparison, not a promise of revenue, inbox placement or a lower invoice. */
export function planAudience(health: AudienceHealth): AudiencePlan {
  const avoided = Math.max(0, Math.min(health.size, health.dormant));
  return {
    standard: health.size,
    economical: health.size - avoided,
    avoided,
    reductionPercent: health.size ? Math.round((avoided / health.size) * 100) : 0,
    unscored: Math.max(0, health.size - health.scored),
  };
}

export function economicalAudienceHealth(health: AudienceHealth): AudienceHealth {
  const plan = planAudience(health);
  return {
    ...health,
    size: plan.economical,
    scored: Math.max(0, health.scored - plan.avoided),
    dormant: 0,
  };
}

export type ContentEfficiency = {
  htmlBytes: number;
  wordCount: number;
  readingSeconds: number;
  sizeBand: "small" | "near_limit" | "over_limit";
};

/** Conservative preview bands. Personalisation and tracking can enlarge the actual message. */
export function measureContent(html: string, text: string): ContentEfficiency {
  const htmlBytes = new TextEncoder().encode(html).byteLength;
  // Links in the plain-text alternative are not words a recipient needs to read.
  const wordCount = (
    text
      .replace(/https?:\/\/\S+/gi, " ")
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
  ).length;
  return {
    htmlBytes,
    wordCount,
    readingSeconds: Math.ceil((wordCount / 200) * 60),
    sizeBand:
      htmlBytes >= 102 * 1024
        ? "over_limit"
        : htmlBytes >= 80 * 1024
          ? "near_limit"
          : "small",
  };
}

export function reviewContentEfficiency(measure: ContentEfficiency): Finding[] {
  const findings: Finding[] = [];
  if (measure.sizeBand !== "small")
    findings.push({
      code:
        measure.sizeBand === "over_limit"
          ? "email_clipping_risk"
          : "email_size_near_limit",
      severity: "warning",
      message:
        measure.sizeBand === "over_limit"
          ? "E-posta Gmail'de kesilme riski taşıyor; alt bölüm gizlenebilir."
          : "E-posta kesilme sınırına yaklaşıyor; kişiselleştirme ve izleme bağlantıları boyutu artırabilir.",
      fix: "Gereksiz HTML ve tekrar eden bölümleri azaltın. Önizlemede 80 KB altında kalmayı hedefleyin; gerçek istemcide kontrol edin.",
    });
  if (measure.wordCount > 600)
    findings.push({
      code: "long_reading_time",
      severity: "info",
      message: "E-postanın tahmini okuma süresi üç dakikadan uzun.",
      fix: "Ana mesajı ve eylemi öne alın; ayrıntıları bir bağlantıda sunmayı değerlendirin. Uzun bültenler için bu yalnızca bir öneridir.",
    });
  return findings;
}
