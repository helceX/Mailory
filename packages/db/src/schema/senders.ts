import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/**
 * A domain an organization wants to send from. Several organizations may CLAIM the same domain, but only one may
 * hold it VERIFIED (partial unique index): whoever first proves control through the per-claim ownership TXT record.
 */
export const senderDomains = pgTable(
  "sender_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    domain: text("domain").notNull(),
    status: text("status").notNull().default("pending"), // pending | verified | failed
    provider: text("provider").notNull(),
    dkimTokens: jsonb("dkim_tokens").$type<string[]>().notNull(),
    // Public (it is published in DNS) and unique per claim, so DKIM records another workspace already published
    // cannot be used to take over a domain.
    ownershipToken: text("ownership_token").notNull(),
    ownershipOk: boolean("ownership_ok").notNull().default(false),
    dkimOk: boolean("dkim_ok").notNull().default(false),
    spfState: text("spf_state"),
    dmarcState: text("dmarc_state"),
    lastCheck: jsonb("last_check").$type<unknown>(),
    lastError: text("last_error"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sender_domains_org_domain_uidx").on(t.organizationId, t.domain),
    uniqueIndex("sender_domains_verified_domain_uidx")
      .on(t.domain)
      .where(sql`${t.status} = 'verified'`),
    index("sender_domains_due_idx").on(t.status, t.lastCheckedAt),
    check(
      "sender_domains_status_check",
      sql`${t.status} in ('pending','verified','failed')`,
    ),
    check("sender_domains_domain_lower_check", sql`${t.domain} = lower(${t.domain})`),
  ],
);

/**
 * "From" identities. Whether one is usable for real sends is derived at read time from the organization's verified
 * domains (a verified domain covers its subdomains), not stored — it can never go stale.
 */
export const senderIdentities = pgTable(
  "sender_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    isDefault: boolean("is_default").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sender_identities_org_email_uidx").on(t.organizationId, t.fromEmail),
    uniqueIndex("sender_identities_one_default_uidx")
      .on(t.organizationId)
      .where(sql`${t.isDefault}`),
    check(
      "sender_identities_email_lower_check",
      sql`${t.fromEmail} = lower(${t.fromEmail})`,
    ),
  ],
);

export type SenderDomain = typeof senderDomains.$inferSelect;
export type SenderIdentity = typeof senderIdentities.$inferSelect;
