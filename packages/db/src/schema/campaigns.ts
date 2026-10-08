import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AutomationTrigger,
  CampaignAudience,
  CampaignUtm,
  Step,
} from "@mailory/core/shared";
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

/** A trigger plus a frozen-on-activation tree of steps. Editable only as a draft; activation freezes content. */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    steps: jsonb("steps").$type<Step[]>().notNull().default([]),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdByUserId: userRef("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("automations_org_idx").on(t.organizationId, t.createdAt),
    index("automations_active_idx")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
    check(
      "automations_status_check",
      sql`${t.status} in ('draft','active','paused','archived')`,
    ),
  ],
);

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
    // 'automation_step' rows are the hidden per-email-step campaigns of an automation: they reuse recipients,
    // sending, tracking, unsubscribe and analytics unchanged, and never appear in the campaign list.
    kind: text("kind").notNull().default("campaign"),
    automationId: uuid("automation_id").references(() => automations.id, {
      onDelete: "cascade",
    }),
    automationStepId: text("automation_step_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("campaigns_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    // The Phase 8 scheduler scans this across tenants.
    index("campaigns_due_idx")
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled'`),
    index("campaigns_automation_idx")
      .on(t.automationId, t.automationStepId)
      .where(sql`${t.automationId} is not null`),
    check("campaigns_kind_check", sql`${t.kind} in ('campaign','automation_step')`),
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
    // First genuine (non-bot) interaction; unique open/click counts are just "is not null".
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
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

/** A distinct destination URL used in a campaign; click events point here, never to a URL carried in the link itself. */
export const campaignLinks = pgTable(
  "campaign_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_links_campaign_url_uidx").on(t.campaignId, t.url)],
);

/**
 * Opens and clicks. Privacy by design (KVKK): no raw IP or user agent is stored — only a daily-rotating salted IP hash
 * and a coarse device class. `is_bot` events (scanners, prefetchers, instant clicks) are kept for transparency but
 * excluded from every metric.
 */
export const trackingEvents = pgTable(
  "tracking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => campaignRecipients.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => campaignLinks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    device: text("device").notNull().default("unknown"),
    ipHash: text("ip_hash"),
    isBot: boolean("is_bot").notNull().default(false),
  },
  (t) => [
    index("tracking_events_campaign_idx").on(t.campaignId, t.type, t.occurredAt),
    index("tracking_events_link_idx").on(t.linkId),
    check("tracking_events_type_check", sql`${t.type} in ('open','click')`),
  ],
);

export type CampaignLink = typeof campaignLinks.$inferSelect;

export const automationEnrollments = pgTable(
  "automation_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    currentStepId: text("current_step_id"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    // The most recent email this contact received from the flow: what "opened/clicked previous" looks at.
    lastRecipientId: uuid("last_recipient_id").references(() => campaignRecipients.id, {
      onDelete: "set null",
    }),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    exitReason: text("exit_reason"),
  },
  (t) => [
    // One run per contact per automation: no accidental re-mailing.
    uniqueIndex("automation_enrollments_uidx").on(t.automationId, t.contactId),
    index("automation_enrollments_due_idx")
      .on(t.nextRunAt)
      .where(sql`${t.status} = 'active'`),
    check(
      "automation_enrollments_status_check",
      sql`${t.status} in ('active','completed','exited')`,
    ),
  ],
);

export type Automation = typeof automations.$inferSelect;
export type AutomationEnrollment = typeof automationEnrollments.$inferSelect;

/** One row per AI call: powers the daily limit and an audit of who used which feature (never the content). */
export const aiRequests = pgTable(
  "ai_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    ok: boolean("ok").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_requests_org_idx").on(t.organizationId, t.createdAt)],
);

/**
 * Outcomes reported by the customer's own systems (a purchase, a registration, a reply) through the public API.
 * Attribution to a campaign is computed once, at recording time (last click in the window, else last send), and stored,
 * so reports stay stable. `external_id` makes retries idempotent.
 */
export const conversions = pgTable(
  "conversions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    email: text("email"),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    recipientId: uuid("recipient_id").references(() => campaignRecipients.id, {
      onDelete: "set null",
    }),
    /** How the campaign was chosen: a click before the conversion, or just the latest send. */
    attribution: text("attribution"),
    value: numeric("value", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("TRY"),
    externalId: text("external_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversions_campaign_idx").on(t.organizationId, t.campaignId, t.occurredAt),
    uniqueIndex("conversions_external_uidx")
      .on(t.organizationId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check(
      "conversions_attribution_chk",
      sql`${t.attribution} in ('click','send') or ${t.attribution} is null`,
    ),
    check("conversions_value_chk", sql`${t.value} >= 0`),
  ],
);
