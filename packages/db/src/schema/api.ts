import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/** Public API keys. Only the SHA-256 of the secret is stored; `prefix` is the public lookup handle. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    scope: text("scope").notNull().default("read"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_keys_prefix_uidx").on(t.prefix),
    index("api_keys_org_idx").on(t.organizationId, t.createdAt),
    check("api_keys_scope_chk", sql`${t.scope} in ('read','write')`),
  ],
);

/**
 * Daily API request counts per workspace (metering for the `api_requests` entitlement). One row per org per UTC day;
 * unlike other usage this is a stored counter because per-request rows would cost more than the product earns.
 */
export const apiUsage = pgTable(
  "api_usage",
  {
    organizationId: orgRef(),
    day: date("day", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.day] })],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    url: text("url").notNull(),
    /** Needed in clear to sign deliveries; shown once on creation. */
    secret: text("secret").notNull(),
    events: text("events").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    disabledReason: text("disabled_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.organizationId, t.createdAt)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    check(
      "webhook_deliveries_status_chk",
      sql`${t.status} in ('pending','delivered','failed')`,
    ),
  ],
);
