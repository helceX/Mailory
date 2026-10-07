import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardrail for ADR-001: a repository function that touches tenant data must take
 * `organizationId: OrganizationId` right after `db`. Functions that are intentionally global
 * (identity / credential / user-scoped) must be listed here — adding to this list is a
 * deliberate, reviewable act.
 */
const GLOBAL_REPOSITORY_FUNCTIONS = new Set([
  // organizations.ts — keyed by user or by a secret credential, never by a client-supplied tenant id
  "createOrganizationWithOwner",
  "listUserMemberships",
  "findInvitationByTokenHash",
  "acceptInvitation",
  "setActiveOrganization", // takes organizationId inside an input object and verifies membership
  // audit.ts — write-only; the org travels inside the entry (null for platform-level events)
  "recordAudit",
  // templates.ts — public image bytes, addressed by an unguessable asset id (like any image URL in an email)
  "getAssetPublic",
  // senders.ts — the domain-check worker sweeps every tenant; it writes back through tenant-scoped functions
  "listDomainsDueForCheck",
  // sending.ts — the engine scans every tenant's due/sending campaigns, then acts through tenant-scoped functions
  "listActiveAutomations", // the automation engine scans every tenant's active automations
  "getActiveAutomationsByIds", // loads the automations behind a claimed batch
  "claimDueEnrollments", // cross-tenant, row-locked claim of due enrolments
  "listOrganizationsOverview", // platform-admin listing (aggregate metrics only; service enforces isPlatformAdmin)
  "createOrganizationWithoutOwner", // creates a tenant (no tenant exists yet to scope by)
  "listPlans", // plan catalog: global reference data, no tenant column
  "getPlanLimits", // limits a plan grants (reference data)
  "purgeDeletedOrganizations", // retention: workspaces past their grace period
  "runRetention", // retention sweep across tenants
  "listDeletedOrganizations", // platform admin: workspaces in their deletion grace period
  "refreshEngagement", // nightly job across tenants (optionally scoped)
  "listDueCampaigns",
  "listSendingCampaigns",
  "listDailyLimited",
  "findRecipientByMessageId", // SES identifies a message only by its id; the row carries its organization
  "recordEmailEvent", // organization travels inside the input (null for events of unknown messages)
  "countSenderDomainClaims", // a count of claims on a domain name; reveals nothing about who claims it
]);
// Identity tables (users, sessions, tokens, outbox) are global by design.
const EXEMPT_FILES = new Set(["auth.ts"]);

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)));

describe("tenancy convention", () => {
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !EXEMPT_FILES.has(f),
  );

  it("checks at least the organization and audit repositories", () => {
    expect(files).toEqual(expect.arrayContaining(["organizations.ts", "audit.ts"]));
  });

  for (const file of files) {
    it(`${file}: every exported function is org-scoped or explicitly global`, () => {
      const source = readFileSync(path.join(dir, file), "utf8");
      const offenders: string[] = [];
      for (const match of source.matchAll(
        /export async function (\w+)\(\s*db: Database,\s*([^,)]*)/g,
      )) {
        const [, name, secondParam] = match;
        if (GLOBAL_REPOSITORY_FUNCTIONS.has(name!)) continue;
        if (!/^organizationId: OrganizationId/.test(secondParam!.trim()))
          offenders.push(name!);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the allowlist contains no stale entries", () => {
    const all = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    for (const name of GLOBAL_REPOSITORY_FUNCTIONS)
      expect(all).toContain(`export async function ${name}(`);
  });
});
