import { and, eq, gte, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { aiRequests, organizations } from "../schema/index";

export async function getAiEnabled(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select({ on: organizations.aiEnabled })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.on ?? false;
}

export async function setAiEnabled(
  db: Database,
  organizationId: OrganizationId,
  on: boolean,
) {
  await db
    .update(organizations)
    .set({ aiEnabled: on, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
}

export async function recordAiRequest(
  db: Database,
  organizationId: OrganizationId,
  input: {
    userId: string | null;
    feature: string;
    ok: boolean;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  await db.insert(aiRequests).values({ organizationId, ...input });
}

export async function countAiRequestsSince(
  db: Database,
  organizationId: OrganizationId,
  since: Date,
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.organizationId, organizationId),
        gte(aiRequests.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}
