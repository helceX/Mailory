import { randomBytes } from "node:crypto";
import type { DnsResolver } from "./dns";
import { DKIM_TARGET_SUFFIX } from "./dns";

export type ProviderDkimStatus = "not_started" | "pending" | "success" | "failed";

/**
 * The sending provider's view of a domain identity (Amazon SES in production). Verification requires BOTH our own
 * DNS check and the provider reporting DKIM success, because the provider is what will actually sign mail.
 */
export interface DomainProvider {
  readonly name: string;
  createIdentity(domain: string): Promise<{ dkimTokens: string[] }>;
  /** `ctx.dkimTokens` is for providers that must be told what to look for (the mock); SES ignores it. */
  getIdentityStatus(
    domain: string,
    ctx: { dkimTokens: string[] },
  ): Promise<{ dkim: ProviderDkimStatus }>;
  deleteIdentity(domain: string): Promise<void>;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
export function randomDkimToken(length = 32): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => BASE32[b % 32]).join("");
}

/** Stands in for SES: issues tokens locally and reports DKIM success once all three CNAMEs resolve, as SES would. */
export class MockDomainProvider implements DomainProvider {
  readonly name = "mock";
  constructor(private readonly resolver: DnsResolver) {}
  async createIdentity() {
    return { dkimTokens: [randomDkimToken(), randomDkimToken(), randomDkimToken()] };
  }
  async getIdentityStatus(domain: string, ctx: { dkimTokens: string[] }) {
    if (ctx.dkimTokens.length === 0) return { dkim: "not_started" as const };
    let found = 0;
    for (const token of ctx.dkimTokens) {
      const targets = (await this.resolver.cname(`${token}._domainkey.${domain}`)).map(
        (t) => t.toLowerCase().replace(/\.$/, ""),
      );
      if (targets.includes(`${token}${DKIM_TARGET_SUFFIX}`)) found++;
    }
    return {
      dkim:
        found === ctx.dkimTokens.length ? ("success" as const) : ("pending" as const),
    };
  }
  async deleteIdentity() {}
}

/** Placeholder until the SES transport lands (Phase 8): refuses to pretend to create an identity. */
export class UnconfiguredSesProvider implements DomainProvider {
  readonly name = "ses";
  async createIdentity(): Promise<never> {
    throw new Error(
      "Amazon SES is not configured yet (DOMAIN_PROVIDER=ses requires the Phase 8 SES integration).",
    );
  }
  async getIdentityStatus(): Promise<never> {
    throw new Error("Amazon SES is not configured yet.");
  }
  async deleteIdentity(): Promise<void> {}
}
