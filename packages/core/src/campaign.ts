/**
 * Campaign lifecycle and pre-send readiness. Pure logic shared by the service (authoritative) and the UI (labels,
 * which actions to offer). The server re-checks every transition; the UI never decides what is allowed.
 */
export const CAMPAIGN_STATUSES = [
  "draft",
  "pending_approval",
  "scheduled",
  "sending",
  "paused",
  "completed",
  "cancelled",
  "failed",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["pending_approval", "scheduled"],
  pending_approval: ["draft", "scheduled", "cancelled"],
  scheduled: ["draft", "sending", "cancelled"],
  sending: ["paused", "completed", "failed", "cancelled"],
  paused: ["sending", "cancelled"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
export function allowedTransitions(from: CampaignStatus): readonly CampaignStatus[] {
  return TRANSITIONS[from];
}
/** Only drafts are editable; once submitted, scheduled or sent the content is pinned. */
export const isEditable = (status: CampaignStatus) => status === "draft";
export const isTerminal = (status: CampaignStatus) => TRANSITIONS[status].length === 0;
export const isCampaignStatus = (v: string): v is CampaignStatus =>
  (CAMPAIGN_STATUSES as readonly string[]).includes(v);

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Taslak",
  pending_approval: "Onay bekliyor",
  scheduled: "Zamanlandı",
  sending: "Gönderiliyor",
  paused: "Duraklatıldı",
  completed: "Tamamlandı",
  cancelled: "İptal edildi",
  failed: "Başarısız",
};

export type CampaignAudience =
  | { kind: "all" }
  | { kind: "list"; id: string }
  | { kind: "segment"; id: string }
  | { kind: "tag"; id: string };

export type CampaignUtm = {
  enabled: boolean;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
};

export const DEFAULT_UTM: CampaignUtm = {
  enabled: true,
  source: "mailory",
  medium: "email",
  campaign: "",
};

/** Lowercase, ASCII, dash-separated: what analytics tools expect in utm_* values. */
export function slugifyUtm(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type ReadinessIssue = {
  code:
    | "no_subject"
    | "no_sender"
    | "sender_unusable"
    | "no_template"
    | "template_archived"
    | "no_audience"
    | "audience_missing"
    | "audience_empty"
    | "no_unsubscribe"
    | "unknown_merge_fields"
    | "empty_content"
    | "schedule_in_past"
    | "subject_long";
  severity: "blocker" | "warning";
  message: string;
};

export type ReadinessInput = {
  subject: string;
  senderIdentity: { usable: boolean } | null;
  hasTemplate: boolean;
  templateArchived: boolean;
  audience: CampaignAudience | null;
  audienceExists: boolean;
  audienceCount: number;
  hasUnsubscribe: boolean;
  unknownMergeKeys: string[];
  blockCount: number;
};

export function evaluateReadiness(input: ReadinessInput): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const block = (code: ReadinessIssue["code"], message: string) =>
    out.push({ code, severity: "blocker", message });
  const warn = (code: ReadinessIssue["code"], message: string) =>
    out.push({ code, severity: "warning", message });

  if (!input.subject.trim()) block("no_subject", "Konu satırı boş.");
  else if (input.subject.length > 78)
    warn("subject_long", "Konu 78 karakterden uzun; birçok istemcide kesilir.");

  if (!input.senderIdentity) block("no_sender", "Gönderici seçilmedi.");
  else if (!input.senderIdentity.usable)
    block(
      "sender_unusable",
      "Seçilen göndericinin alan adı doğrulanmamış. Alan adını doğrulayın veya başka bir gönderici seçin.",
    );

  if (!input.hasTemplate) block("no_template", "Şablon seçilmedi.");
  else if (input.templateArchived)
    block("template_archived", "Seçilen şablon arşivlenmiş.");
  else if (input.blockCount === 0) block("empty_content", "Şablonun içeriği boş.");

  if (!input.audience) block("no_audience", "Alıcı kitlesi seçilmedi.");
  else if (!input.audienceExists)
    block("audience_missing", "Seçilen liste/segment/etiket artık yok.");
  else if (input.audienceCount === 0)
    block(
      "audience_empty",
      "Bu kitlede gönderilebilir alıcı yok (abone olmayan ve bastırılmış adresler hariç tutulur).",
    );

  if (input.hasTemplate && !input.hasUnsubscribe)
    block(
      "no_unsubscribe",
      "E-postada abonelikten çıkma bağlantısı yok. Alt bilgi bloğunda 'Abonelikten çık' bağlantısını açın.",
    );
  if (input.unknownMergeKeys.length > 0)
    warn(
      "unknown_merge_fields",
      `Tanınmayan kişiselleştirme alanları boş/yedek değerle gider: ${input.unknownMergeKeys.join(", ")}`,
    );
  return out;
}
export const hasBlockers = (issues: ReadinessIssue[]) =>
  issues.some((i) => i.severity === "blocker");
