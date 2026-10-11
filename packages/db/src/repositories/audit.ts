import { and, desc, eq, lt } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { auditLogs } from "../schema/index";

export type AuditEntry = {
  organizationId: OrganizationId | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

/** Platform-level events (no org) pass `organizationId: null`. */
export async function recordAudit(db: Database, entry: AuditEntry) {
  await db.insert(auditLogs).values({
    organizationId: entry.organizationId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    metadata: entry.metadata ?? {},
  });
}

export async function listAuditLogs(
  db: Database,
  organizationId: OrganizationId,
  options: { limit?: number; before?: Date } = {},
) {
  const limit = Math.min(options.limit ?? 50, 200);
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        options.before ? lt(auditLogs.createdAt, options.before) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
