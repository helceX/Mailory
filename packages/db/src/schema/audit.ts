import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Append-only. `organization_id` and `user_id` are deliberately plain uuids WITHOUT foreign
 * keys: deleting an org or user must never cascade away the record of what happened.
 * Metadata must not hold personal data (use ids, not emails).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
