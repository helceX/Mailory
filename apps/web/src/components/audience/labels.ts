export const STATUS_LABELS: Record<string, string> = {
  subscribed: "Abone",
  unsubscribed: "Abonelikten çıktı",
  bounced: "Geri döndü",
  complained: "Şikayet etti",
  cleaned: "Temizlendi",
};
export const STATUS_TONES: Record<
  string,
  "success" | "neutral" | "warning" | "danger"
> = {
  subscribed: "success",
  unsubscribed: "neutral",
  bounced: "warning",
  complained: "danger",
  cleaned: "neutral",
};
export const CONSENT_LABELS: Record<string, string> = {
  granted: "Verildi",
  unknown: "Bilinmiyor",
  withdrawn: "Geri çekildi",
};
export const REASON_LABELS: Record<string, string> = {
  unsubscribe: "Abonelikten çıktı",
  hard_bounce: "Kalıcı geri dönme",
  complaint: "Şikayet",
  manual: "Elle eklendi",
  import: "İçe aktarım",
};
export const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Metin",
  number: "Sayı",
  date: "Tarih",
  boolean: "Evet/Hayır",
  select: "Seçim",
};

export function fullName(c: { firstName: string | null; lastName: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ");
}
export async function apiCall(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data };
    return {
      ok: false,
      message:
        (data as { error?: { message?: string } } | null)?.error?.message ??
        "İşlem tamamlanamadı.",
    };
  } catch {
    return {
      ok: false,
      message: "Bağlantı hatası. İnternet bağlantınızı kontrol edin.",
    };
  }
}
