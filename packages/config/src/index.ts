import { z } from "zod";

/** Every external dependency is configured via env, validated once at boot. */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    EMAIL_PROVIDER: z.enum(["console", "ses"]).default("console"),
    EMAIL_FROM: z.string().default("Mailory <no-reply@mailory.io>"),
    AWS_REGION: z.string().optional(),
    SES_CONFIGURATION_SET: z.string().optional(),
    // The SNS topic SES publishes bounce/complaint/delivery events to; the webhook accepts only this topic.
    SES_SNS_TOPIC_ARN: z.string().optional(),
    // Emails per second this worker may send (SES accounts start at 14/s).
    SEND_RATE_PER_SECOND: z.coerce.number().int().min(1).max(500).default(14),
    // AI assistant (Phase 12). "none" disables it entirely; "mock" is for tests/dev only.
    AI_PROVIDER: z.enum(["none", "mock", "anthropic"]).default("none"),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default("claude-haiku-4-5-20251001"),
    AI_DAILY_LIMIT_PER_ORG: z.coerce.number().int().min(0).max(100000).default(50),
    SENTRY_DSN: z.string().optional(),
    DEFAULT_TIMEZONE: z.string().default("Europe/Istanbul"),
    DEFAULT_LOCALE: z.enum(["tr", "en"]).default("tr"),
    // How domain DNS records are looked up. "mock" reads MOCK_DNS_FILE and exists only for tests/dev.
    DNS_RESOLVER: z.enum(["system", "mock"]).default("system"),
    MOCK_DNS_FILE: z.string().optional(),
    // "mock" = verification derived from real DNS only (no SES identity); "ses" arrives with the Phase 8 SES integration.
    DOMAIN_PROVIDER: z.enum(["mock", "ses"]).default("mock"),
  })
  .check((ctx) => {
    if (ctx.value.NODE_ENV === "production" && ctx.value.DNS_RESOLVER === "mock") {
      ctx.issues.push({
        code: "custom",
        message: 'DNS_RESOLVER="mock" is not allowed in production',
        input: ctx.value,
        path: ["DNS_RESOLVER"],
      });
    }
    if (ctx.value.NODE_ENV === "production" && ctx.value.AI_PROVIDER === "mock")
      ctx.issues.push({
        code: "custom",
        message: 'AI_PROVIDER="mock" is not allowed in production',
        input: ctx.value,
        path: ["AI_PROVIDER"],
      });
    if (ctx.value.AI_PROVIDER === "anthropic" && !ctx.value.ANTHROPIC_API_KEY)
      ctx.issues.push({
        code: "custom",
        message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER is "anthropic"',
        input: ctx.value,
        path: ["ANTHROPIC_API_KEY"],
      });
    if (ctx.value.EMAIL_PROVIDER === "ses") {
      for (const key of [
        "AWS_REGION",
        "SES_CONFIGURATION_SET",
        "SES_SNS_TOPIC_ARN",
      ] as const) {
        if (!ctx.value[key])
          ctx.issues.push({
            code: "custom",
            message: `${key} is required when EMAIL_PROVIDER is "ses"`,
            input: ctx.value,
            path: [key],
          });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  return result.data;
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
