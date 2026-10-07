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
    if (ctx.value.EMAIL_PROVIDER === "ses" && !ctx.value.AWS_REGION) {
      ctx.issues.push({
        code: "custom",
        message: 'AWS_REGION is required when EMAIL_PROVIDER is "ses"',
        input: ctx.value,
        path: ["AWS_REGION"],
      });
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
