import type { CampaignStatus } from "@mailory/core/shared";

export const STATUS_TONE: Record<
  CampaignStatus,
  "neutral" | "success" | "warning" | "danger" | "info"
> = {
  draft: "neutral",
  pending_approval: "warning",
  scheduled: "info",
  sending: "info",
  paused: "warning",
  completed: "success",
  cancelled: "neutral",
  failed: "danger",
};

export const AUDIENCE_KIND_LABELS = {
  all: "Tüm aboneler",
  list: "Liste",
  segment: "Segment",
  tag: "Etiket",
} as const;

export function formatWhen(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
