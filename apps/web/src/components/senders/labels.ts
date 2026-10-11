export const DOMAIN_STATUS: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  verified: { label: "Doğrulandı", tone: "success" },
  pending: { label: "Doğrulama bekliyor", tone: "warning" },
  failed: { label: "Doğrulama başarısız", tone: "danger" },
};

export const RECORD_STATE: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  ok: { label: "Doğrulandı", tone: "success" },
  missing: { label: "Bulunamadı", tone: "warning" },
  mismatch: { label: "Hatalı değer", tone: "danger" },
  warning: { label: "Öneri", tone: "warning" },
  error: { label: "Sorgulanamadı", tone: "neutral" },
};

export type RecordResultView = {
  key: string;
  state: string;
  found: string[];
  message: string;
};
