import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CampaignAudience, CampaignUtm } from "@mailory/core/shared";
import { organizations } from "./organizations";
import { senderIdentities } from "./senders";
import { templates, templateVersions } from "./templates";
import { contacts } from "./audience";
import { users } from "./users";

const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const userRef = (name: string) =>
  uuid(name).references(() => users.id, { onDelete: "set null" });

/** What was actually scheduled: frozen at schedule/approval time so later edits never change an approved send. */
export type CampaignSnapshot = {
  doc: unknown;
  version: number;
  brand: unknown;
  sender: { fromName: string; fromEmail: string; replyTo: string | null };
  audienceCount: number;
  takenAt: string;
};

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    subject: text("subject").notNull().default(""),
    preheader: text("preheader").notNull().default(""),
    senderIdentityId: uuid("sender_identity_id").references(() => senderIdentities.id, {
      onDelete: "set null",
    }),
    replyTo: text("reply_to"),
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    templateVersionId: uuid("template_version_id").references(
      () => templateVersions.id,
      {
        onDelete: "set null",
      },
    ),
    audience: jsonb("audience").$type<CampaignAudience | null>(),
    utm: jsonb("utm").$type<CampaignUtm>().notNull(),
    trackOpens: boolean("track_opens").notNull().default(true),
    trackClicks: boolean("track_clicks").notNull().default(true),
    snapshot: jsonb("snapshot").$type<CampaignSnapshot | null>(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: userRef("created_by_user_id"),
    submittedByUserId: userRef("submitted_by_user_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedByUserId: userRef("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    // Why the engine (not a person) paused or failed it: daily cap, bounce rate, complaint rate, sender lost verification.
    haltReason: text("halt_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("campaigns_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    // The Phase 8 scheduler scans this across tenants.
    index("campaigns_due_idx")
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled'`),
    check(
      "campaigns_status_check",
      sql`${t.status} in ('draft','pending_approval','scheduled','sending','paused','completed','cancelled','failed')`,
    ),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;

export const RECIPIENT_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
] as const;

/** One row per (campaign, contact): the unit of work for the send engine and the idempotency key against double sends. */
export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_recipients_campaign_contact_uidx").on(
      t.campaignId,
      t.contactId,
    ),
    index("campaign_recipients_work_idx").on(t.campaignId, t.status, t.nextAttemptAt),
    uniqueIndex("campaign_recipients_message_uidx")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    index("campaign_recipients_org_sent_idx")
      .on(t.organizationId, t.sentAt)
      .where(sql`${t.sentAt} is not null`),
    check(
      "campaign_recipients_status_check",
      sql`${t.status} in ('queued','sending','sent','delivered','bounced','complained','failed','skipped')`,
    ),
  ],
);

/** Raw provider notifications (SES via SNS). `provider_event_id` makes redelivery harmless. */
export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    recipientId: uuid("recipient_id").references(() => campaignRecipients.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<unknown>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_events_provider_uidx").on(t.providerEventId),
    index("email_events_campaign_idx").on(t.campaignId, t.type),
  ],
);

export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
