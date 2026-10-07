import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/**
 * Uploaded images (logos, email images). Stored in Postgres for now so the product works without an
 * object store; the `/a/<id>` URL contract lets us move bytes to R2/S3 later without touching templates.
 * Only raster types verified by magic bytes are accepted — never SVG (scriptable).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    filename: text("filename"),
    data: bytea("data").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_org_idx").on(t.organizationId, t.createdAt)],
);

export const brandKits = pgTable("brand_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId().unique(),
  logoAssetId: uuid("logo_asset_id").references(() => assets.id, {
    onDelete: "set null",
  }),
  primaryColor: text("primary_color").notNull(),
  textColor: text("text_color").notNull(),
  backgroundColor: text("background_color").notNull(),
  linkColor: text("link_color").notNull(),
  buttonColor: text("button_color").notNull(),
  buttonTextColor: text("button_text_color").notNull(),
  font: text("font").notNull(),
  buttonRadius: smallint("button_radius").notNull(),
  footerText: text("footer_text").notNull().default(""),
  socialLinks: jsonb("social_links")
    .$type<{ network: string; url: string }[]>()
    .notNull()
    .default([]),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    category: text("category").notNull().default("other"),
    sourceLibraryKey: text("source_library_key"),
    // Plain uuid (no FK): versions reference the template, and a pointer back would be circular.
    currentVersionId: uuid("current_version_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A name is unique among live templates; archiving frees it.
    uniqueIndex("templates_org_name_live_uidx")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    index("templates_org_updated_idx").on(t.organizationId, t.updatedAt),
  ],
);

/** Immutable snapshots: a campaign pins a version, so later edits can never change what was sent. */
export const templateVersions = pgTable(
  "template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    version: integer("version").notNull(),
    doc: jsonb("doc").$type<unknown>().notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_versions_template_version_uidx").on(t.templateId, t.version),
    index("template_versions_org_idx").on(t.organizationId),
  ],
);

export type Template = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type Asset = typeof assets.$inferSelect;

/**
 * BTM Template Hub: templates a partner organization publishes for the organizations it sponsors. A snapshot of the
 * document, owned by the partner. Children copy it into their own workspace; nothing else is shared.
 */
export const sharedTemplates = pgTable(
  "shared_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganizationId: uuid("partner_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull().default("other"),
    description: text("description"),
    doc: jsonb("doc").$type<unknown>().notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("shared_templates_partner_idx").on(t.partnerOrganizationId, t.createdAt),
  ],
);
export type SharedTemplate = typeof sharedTemplates.$inferSelect;
