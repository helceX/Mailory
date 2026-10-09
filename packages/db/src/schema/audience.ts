import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    // Always lowercase (CHECK) so a plain unique index serves both uniqueness and ON CONFLICT upserts.
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    position: text("position"),
    website: text("website"),
    phone: text("phone"),
    sector: text("sector"),
    city: text("city"),
    status: text("status").notNull().default("subscribed"),
    // KVKK: who consented, how, when — stored per contact.
    consentStatus: text("consent_status").notNull().default("unknown"),
    consentSource: text("consent_source"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    source: text("source"),
    custom: jsonb("custom")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    // Computed by a scheduled job once tracking exists (Phase 9); null = not scored yet.
    engagementScore: smallint("engagement_score"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contacts_org_email_uidx").on(t.organizationId, t.email),
    index("contacts_org_created_idx").on(t.organizationId, t.createdAt, t.id),
    index("contacts_org_status_idx").on(t.organizationId, t.status),
    check("contacts_email_lower_check", sql`${t.email} = lower(${t.email})`),
    check(
      "contacts_status_check",
      sql`${t.status} in ('subscribed','unsubscribed','bounced','complained','cleaned')`,
    ),
    check(
      "contacts_consent_check",
      sql`${t.consentStatus} in ('granted','unknown','withdrawn')`,
    ),
  ],
);

export const contactFields = pgTable(
  "contact_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    options: jsonb("options").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_fields_org_key_uidx").on(t.organizationId, t.key),
    check(
      "contact_fields_type_check",
      sql`${t.type} in ('text','number','date','boolean','select')`,
    ),
  ],
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lists_org_name_uidx").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const listContactLinks = pgTable(
  "list_contacts",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.contactId] }),
    index("list_contacts_contact_idx").on(t.contactId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tags_org_name_uidx").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.contactId] }),
    index("contact_tags_contact_idx").on(t.contactId),
  ],
);

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<unknown>().notNull(),
    lastCount: integer("last_count"),
    lastCountedAt: timestamp("last_counted_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("segments_org_name_uidx").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

/** The single source of truth consulted before any send. Per organization, keyed by lowercase email. */
export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    email: text("email").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("suppressions_org_email_uidx").on(t.organizationId, t.email),
    check(
      "suppressions_reason_check",
      sql`${t.reason} in ('unsubscribe','hard_bounce','complaint','manual','import')`,
    ),
  ],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    filename: text("filename"),
    total: integer("total").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    invalid: integer("invalid").notNull().default(0),
    suppressed: integer("suppressed").notNull().default(0),
    errors: jsonb("errors")
      .$type<{ row: number; message: string }[]>()
      .notNull()
      .default([]),
    // Proof the importer stated recipients consented (KVKK / anti-spam).
    consentAttested: boolean("consent_attested").notNull(),
    consentAttestedAt: timestamp("consent_attested_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_jobs_org_idx").on(t.organizationId, t.createdAt)],
);

export type Contact = typeof contacts.$inferSelect;
export type ContactField = typeof contactFields.$inferSelect;
export type List = typeof lists.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Segment = typeof segments.$inferSelect;
