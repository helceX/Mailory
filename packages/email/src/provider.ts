import { randomBytes } from "node:crypto";
import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  SESv2Client,
  type DkimAttributes,
} from "@aws-sdk/client-sesv2";
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

/** Uses the same region and default credential chain as the sending transport. */
export class SesDomainProvider implements DomainProvider {
  readonly name = "ses";
  private readonly client: Pick<SESv2Client, "send">;
  constructor(region: string, client?: Pick<SESv2Client, "send">) {
    this.client = client ?? new SESv2Client({ region });
  }
  async createIdentity(domain: string) {
    let attributes: DkimAttributes | undefined;
    try {
      const identity = await this.client.send(
        new CreateEmailIdentityCommand({ EmailIdentity: domain }),
      );
      attributes = identity.DkimAttributes;
    } catch (error) {
      // A domain may already be used by another workspace. Keep its existing keys.
      if ((error as { name?: string })?.name !== "AlreadyExistsException") throw error;
      attributes = (
        await this.client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
      ).DkimAttributes;
    }
    const tokens = attributes?.Tokens;
    // The DNS flow requires three Easy DKIM keys; BYODKIM identities cannot use it.
    if (
      !tokens ||
      tokens.length !== 3 ||
      new Set(tokens).size !== 3 ||
      tokens.some((token) => !/^[a-z2-7]{32}$/.test(token))
    ) {
      throw new Error("Amazon SES identity requires three valid Easy DKIM tokens.");
    }
    return { dkimTokens: tokens };
  }
  async getIdentityStatus(domain: string): Promise<{ dkim: ProviderDkimStatus }> {
    try {
      const identity = await this.client.send(
        new GetEmailIdentityCommand({ EmailIdentity: domain }),
      );
      const attributes = identity.DkimAttributes;
      switch (attributes?.Status) {
        case "SUCCESS":
          // DNS alone is insufficient: SES must sign and permit sending too.
          return {
            dkim:
              attributes.SigningEnabled && identity.VerifiedForSendingStatus
                ? "success"
                : "pending",
          };
        case "FAILED":
          return { dkim: "failed" };
        case "TEMPORARY_FAILURE":
          throw new Error("Amazon SES DKIM verification is temporarily unavailable.");
        case "PENDING":
          return { dkim: "pending" };
        case "NOT_STARTED":
          return { dkim: "not_started" };
        default:
          throw new Error("Amazon SES returned an unknown DKIM status.");
      }
    } catch (error) {
      if ((error as { name?: string })?.name === "NotFoundException")
        return { dkim: "not_started" };
      throw error;
    }
  }
  async deleteIdentity(domain: string): Promise<void> {
    try {
      await this.client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
    } catch (error) {
      if ((error as { name?: string })?.name !== "NotFoundException") throw error;
    }
  }
}
