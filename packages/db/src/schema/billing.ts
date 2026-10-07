import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

const orgRef = (name = "organization_id") =>
  uuid(name)
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const plans = pgTable("plans", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  isPublic: boolean("is_public").notNull().default(true),
  sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
});

/** limit_value NULL = unlimited. A plan without a row for a key means 0 (fail closed). */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    planKey: text("plan_key")
      .notNull()
      .references(() => plans.key, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(),
    limitValue: bigint("limit_value", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.planKey, t.entitlementKey] })],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef().unique(),
    planKey: text("plan_key")
      .notNull()
      .references(() => plans.key),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("manual"),
    // For sponsored access: the partner organization that granted it (it sees status/usage, never content).
    sponsorOrganizationId: uuid("sponsor_organization_id").references(
      () => organizations.id,
      {
        onDelete: "set null",
      },
    ),
    note: text("note"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_sponsor_idx").on(t.sponsorOrganizationId),
    check(
      "subscriptions_status_check",
      sql`${t.status} in ('active','trialing','paused','canceled')`,
    ),
    check(
      "subscriptions_source_check",
      sql`${t.source} in ('manual','sponsored','stripe')`,
    ),
  ],
);

/** Per-organization exceptions (sponsored limits): a row with NULL limit means explicitly unlimited. */
export const entitlementOverrides = pgTable(
  "entitlement_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    entitlementKey: text("entitlement_key").notNull(),
    limitValue: bigint("limit_value", { mode: "number" }),
    reason: text("reason"),
    setByUserId: uuid("set_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    setByOrganizationId: uuid("set_by_organization_id").references(
      () => organizations.id,
      {
        onDelete: "set null",
      },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entitlement_overrides_uidx").on(t.organizationId, t.entitlementKey),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
