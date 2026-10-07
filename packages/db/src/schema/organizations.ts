import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/** The tenant boundary. Every tenant-scoped table references this. */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    type: text("type").notNull().default("standard"), // standard | partner
    // BTM → entrepreneur hierarchy (D-007). Grants NO content access by itself; it only
    // lets a partner see sponsorship/usage views. Content tables never join on this.
    parentOrganizationId: uuid("parent_organization_id").references(
      (): AnyPgColumn => organizations.id,
      {
        onDelete: "set null",
      },
    ),
    defaultTimezone: text("default_timezone").notNull().default("Europe/Istanbul"),
    // Four-eyes policy: editors must submit campaigns; a different admin approves before they are scheduled.
    requireCampaignApproval: boolean("require_campaign_approval")
      .notNull()
      .default(false),
    // Abuse guard: most e-mails an organization may send per UTC day. New workspaces start low (warm-up);
    // a platform admin raises it. 0 = sending disabled.
    // AI assistant sends email text to a third-party model, so it is opt-in per organization (KVKK).
    // Set by a platform/partner admin; a suspended organization cannot send (the engine pauses its campaigns).
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    dailySendLimit: integer("daily_send_limit").notNull().default(2000),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("organizations_type_check", sql`${table.type} in ('standard', 'partner')`),
    index("organizations_parent_idx").on(table.parentOrganizationId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"), // active | revoked
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_org_user_uidx").on(table.organizationId, table.userId),
    index("memberships_user_idx").on(table.userId),
    check(
      "memberships_role_check",
      sql`${table.role} in ('owner', 'admin', 'editor', 'viewer')`,
    ),
    check("memberships_status_check", sql`${table.status} in ('active', 'revoked')`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitations_org_idx").on(table.organizationId, table.createdAt),
    check(
      "invitations_role_check",
      sql`${table.role} in ('owner', 'admin', 'editor', 'viewer')`,
    ),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
