import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Global identity — NOT tenant-scoped. A user reaches organizations via memberships (Phase 3). */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Always stored lowercase (validation normalizes); the index on lower() is defense in depth.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    locale: text("locale").notNull().default("tr"),
    timezone: text("timezone").notNull().default("Europe/Istanbul"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_lower_uidx").on(sql`lower(${table.email})`)],
);

export type User = typeof users.$inferSelect;
