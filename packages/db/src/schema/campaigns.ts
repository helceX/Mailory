import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { CampaignAudience, CampaignUtm } from "@mailory/core/shared";
import { organizations } from "./organizations";
import { senderIdentities } from "./senders";
import { templates, templateVersions } from "./templates";
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
