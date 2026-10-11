export type AiRequest = {
  /** Which product feature is asking (used for scripting the mock and for audit; never sent as instructions). */
  feature: "subjects" | "review" | "analyst" | "draft";
  system: string;
  user: string;
  maxTokens?: number;
};
export type AiResponse = { text: string; inputTokens?: number; outputTokens?: number };

export type AiErrorCode =
  | "rate_limited"
  | "unavailable"
  | "invalid_key"
  | "bad_response"
  | "timeout";
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Anthropic Messages API over plain fetch (no SDK dependency). The key is only ever sent to the API host; failures are
 * mapped to coarse codes so callers can show a clear message without leaking provider details.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      timeoutMs?: number;
      fetch?: FetchLike;
    },
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    const doFetch: FetchLike = this.options.fetch ?? ((u, i) => fetch(u, i));
    let res: Response;
    try {
      res = await doFetch(
        `${this.options.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.options.model,
            max_tokens: request.maxTokens ?? 1024,
            system: request.system,
            messages: [{ role: "user", content: request.user }],
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        },
      );
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError")
        throw new AiError("timeout", "AI isteği zaman aşımına uğradı.");
      throw new AiError("unavailable", "AI sağlayıcısına ulaşılamadı.");
    }
    if (res.status === 401 || res.status === 403)
      throw new AiError("invalid_key", "AI anahtarı geçersiz.");
    if (res.status === 429)
      throw new AiError("rate_limited", "AI sağlayıcısı yoğun; biraz sonra deneyin.");
    if (res.status >= 500)
      throw new AiError("unavailable", "AI sağlayıcısı şu anda yanıt vermiyor.");
    if (!res.ok) throw new AiError("bad_response", "AI isteği reddedildi.");
    let body: {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new AiError("bad_response", "AI yanıtı okunamadı.");
    }
    const text = (body.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (!text.trim()) throw new AiError("bad_response", "AI boş yanıt döndürdü.");
    return {
      text,
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
    };
  }
}

/** Deterministic stand-in for tests and local development (never allowed in production). */
export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  readonly calls: AiRequest[] = [];
  constructor(
    private readonly script: Partial<
      Record<AiRequest["feature"], string | (() => string)>
    > = {},
  ) {}
  async complete(request: AiRequest): Promise<AiResponse> {
    this.calls.push(request);
    const s = this.script[request.feature];
    const text = typeof s === "function" ? s() : (s ?? DEFAULT_MOCK[request.feature]);
    return { text };
  }
}

const DEFAULT_MOCK: Record<AiRequest["feature"], string> = {
  subjects: JSON.stringify({
    suggestions: [
      {
        subject: "Mart bülteni: yenilikler ve ipuçları",
        preheader: "Bu ay neler yaptık?",
      },
      { subject: "Sizin için hazırladık", preheader: "Kısa bir özet" },
      { subject: "Yeni özelliklerimizi keşfedin", preheader: "Üç dakikada okuyun" },
    ],
  }),
  review: JSON.stringify({
    summary: "Mesaj anlaşılır; çağrı net.",
    suggestions: [
      { area: "Çağrı", text: "Düğme metnini daha somut yapın.", severity: "info" },
    ],
  }),
  analyst: JSON.stringify({
    summary: "Açılma oranı ortalamanın üzerinde.",
    insights: ["Tıklama oranı açılmaya göre düşük."],
    nextActions: ["Çağrı düğmesini e-postanın başına taşıyın."],
  }),
  draft: JSON.stringify({
    title: "Taslak",
    blocks: [
      { type: "heading", text: "Merhaba {{first_name|dost}}", level: 1 },
      { type: "paragraph", text: "Size kısa bir güncelleme paylaşmak istedik." },
      { type: "button", label: "Devamını oku", href: "https://example.com" },
    ],
  }),
};

export type AiConfig = {
  AI_PROVIDER: "none" | "mock" | "anthropic";
  ANTHROPIC_API_KEY?: string;
  AI_MODEL: string;
};

export function createAiProvider(
  config: AiConfig,
  override?: AiProvider,
): AiProvider | null {
  if (override) return override;
  if (config.AI_PROVIDER === "anthropic") {
    if (!config.ANTHROPIC_API_KEY)
      throw new Error("ANTHROPIC_API_KEY is required for AI_PROVIDER=anthropic");
    return new AnthropicProvider({
      apiKey: config.ANTHROPIC_API_KEY,
      model: config.AI_MODEL,
    });
  }
  if (config.AI_PROVIDER === "mock") return new MockAiProvider();
  return null;
}
