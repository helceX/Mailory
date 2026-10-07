import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import {
  contactFields,
  contacts,
  importJobs,
  lists,
  segments,
  suppressions,
  tags,
} from "../schema/index";

const isUnique = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

// ---- lists ----------------------------------------------------------------------------------------

export async function createList(
  db: Database,
  organizationId: OrganizationId,
  input: { name: string; description?: string | null },
) {
  try {
    const [row] = await db
      .insert(lists)
      .values({
        organizationId,
        name: input.name,
        description: input.description ?? null,
      })
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listLists(db: Database, organizationId: OrganizationId) {
  const result = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    created_at: Date;
    contact_count: number;
  }>(sql`
    select l.id, l.name, l.description, l.created_at,
      (select count(*)::int from list_contacts lc where lc.list_id = l.id and lc.organization_id = ${organizationId}::uuid) as contact_count
    from lists l where l.organization_id = ${organizationId}::uuid order by lower(l.name)`);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.created_at,
    contactCount: r.contact_count,
  }));
}

export async function getList(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.organizationId, organizationId), eq(lists.id, id)))
    .limit(1);
  return row ?? null;
}

export async function updateList(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  input: { name: string; description?: string | null },
) {
  try {
    const [row] = await db
      .update(lists)
      .set({ name: input.name, description: input.description ?? null })
      .where(and(eq(lists.organizationId, organizationId), eq(lists.id, id)))
      .returning();
    return row ?? "not_found";
  } catch (error) {
    if (isUnique(error)) return "duplicate" as const;
    throw error;
  }
}

export async function deleteList(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(lists)
    .where(and(eq(lists.organizationId, organizationId), eq(lists.id, id)))
    .returning({ id: lists.id });
  return rows.length > 0;
}

// ---- tags -----------------------------------------------------------------------------------------

export async function createTag(
  db: Database,
  organizationId: OrganizationId,
  name: string,
) {
  try {
    const [row] = await db.insert(tags).values({ organizationId, name }).returning();
    return row ?? null;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listTags(db: Database, organizationId: OrganizationId) {
  const result = await db.execute<{
    id: string;
    name: string;
    contact_count: number;
  }>(sql`
    select t.id, t.name,
      (select count(*)::int from contact_tags ct where ct.tag_id = t.id and ct.organization_id = ${organizationId}::uuid) as contact_count
    from tags t where t.organization_id = ${organizationId}::uuid order by lower(t.name)`);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactCount: r.contact_count,
  }));
}

export async function deleteTag(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(tags)
    .where(and(eq(tags.organizationId, organizationId), eq(tags.id, id)))
    .returning({ id: tags.id });
  return rows.length > 0;
}

// ---- custom fields --------------------------------------------------------------------------------

export async function createContactField(
  db: Database,
  organizationId: OrganizationId,
  input: { key: string; label: string; type: string; options?: string[] },
) {
  try {
    const [row] = await db
      .insert(contactFields)
      .values({
        organizationId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options ?? null,
      })
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listContactFields(db: Database, organizationId: OrganizationId) {
  return db
    .select()
    .from(contactFields)
    .where(eq(contactFields.organizationId, organizationId))
    .orderBy(asc(contactFields.createdAt));
}

/** Deleting a field also strips its values from this organization's contacts. */
export async function deleteContactField(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  return db.transaction(async (tx) => {
    const [field] = await tx
      .delete(contactFields)
      .where(
        and(eq(contactFields.organizationId, organizationId), eq(contactFields.id, id)),
      )
      .returning();
    if (!field) return false;
    await tx
      .update(contacts)
      .set({ custom: sql`${contacts.custom} - ${field.key}::text` })
      .where(
        and(
          eq(contacts.organizationId, organizationId),
          sql`${contacts.custom} ? ${field.key}::text`,
        ),
      );
    return true;
  });
}

// ---- segments -------------------------------------------------------------------------------------

export async function createSegment(
  db: Database,
  organizationId: OrganizationId,
  input: { name: string; definition: unknown; userId: string | null },
) {
  try {
    const [row] = await db
      .insert(segments)
      .values({
        organizationId,
        name: input.name,
        definition: input.definition,
        createdByUserId: input.userId,
      })
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listSegments(db: Database, organizationId: OrganizationId) {
  return db
    .select()
    .from(segments)
    .where(eq(segments.organizationId, organizationId))
    .orderBy(asc(segments.name));
}

export async function getSegment(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.organizationId, organizationId), eq(segments.id, id)))
    .limit(1);
  return row ?? null;
}

export async function updateSegment(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  input: { name: string; definition: unknown },
) {
  try {
    const [row] = await db
      .update(segments)
      .set({
        name: input.name,
        definition: input.definition,
        lastCount: null,
        lastCountedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(segments.organizationId, organizationId), eq(segments.id, id)))
      .returning();
    return row ?? ("not_found" as const);
  } catch (error) {
    if (isUnique(error)) return "duplicate" as const;
    throw error;
  }
}

export async function setSegmentCount(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  count: number,
) {
  await db
    .update(segments)
    .set({ lastCount: count, lastCountedAt: new Date() })
    .where(and(eq(segments.organizationId, organizationId), eq(segments.id, id)));
}

export async function deleteSegment(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const rows = await db
    .delete(segments)
    .where(and(eq(segments.organizationId, organizationId), eq(segments.id, id)))
    .returning({ id: segments.id });
  return rows.length > 0;
}

// ---- suppression ----------------------------------------------------------------------------------

const REASON_TO_STATUS: Record<string, string> = {
  unsubscribe: "unsubscribed",
  hard_bounce: "bounced",
  complaint: "complained",
  manual: "cleaned",
  import: "cleaned",
};

/** Adds emails to the suppression list and flips any matching contacts, atomically. */
export async function addSuppressions(
  db: Database,
  organizationId: OrganizationId,
  input: { emails: string[]; reason: string; userId: string | null },
) {
  const emails = [...new Set(input.emails.map((e) => e.toLowerCase()))];
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(suppressions)
      .values(
        emails.map((email) => ({
          organizationId,
          email,
          reason: input.reason,
          createdByUserId: input.userId,
        })),
      )
      .onConflictDoNothing({
        target: [suppressions.organizationId, suppressions.email],
      })
      .returning({ id: suppressions.id });
    const now = new Date();
    const status = REASON_TO_STATUS[input.reason] ?? "cleaned";
    await tx
      .update(contacts)
      .set({
        status,
        updatedAt: now,
        ...(status === "unsubscribed"
          ? { unsubscribedAt: now, consentStatus: "withdrawn" }
          : {}),
      })
      .where(
        and(
          eq(contacts.organizationId, organizationId),
          inArray(contacts.email, emails),
        ),
      );
    return { added: inserted.length, alreadyPresent: emails.length - inserted.length };
  });
}

export async function removeSuppression(
  db: Database,
  organizationId: OrganizationId,
  email: string,
) {
  const rows = await db
    .delete(suppressions)
    .where(
      and(
        eq(suppressions.organizationId, organizationId),
        eq(suppressions.email, email.toLowerCase()),
      ),
    )
    .returning({ id: suppressions.id });
  return rows.length > 0;
}

export async function listSuppressions(
  db: Database,
  organizationId: OrganizationId,
  options: { q?: string; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(options.limit ?? 50, 200);
  const where = and(
    eq(suppressions.organizationId, organizationId),
    options.q
      ? sql`${suppressions.email} like ${"%" + options.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`) + "%"} escape '\\'`
      : undefined,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(suppressions)
      .where(where)
      .orderBy(desc(suppressions.createdAt), desc(suppressions.id))
      .limit(limit)
      .offset(options.offset ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(suppressions)
      .where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** Which of these (lowercase) emails are suppressed in this organization. */
export async function findSuppressedEmails(
  db: Database,
  organizationId: OrganizationId,
  input: string[],
) {
  const emails = [...new Set(input.map((e) => e.toLowerCase()))];
  if (emails.length === 0) return new Set<string>();
  const rows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.organizationId, organizationId),
        inArray(suppressions.email, emails),
      ),
    );
  return new Set(rows.map((r) => r.email));
}

// ---- import jobs ----------------------------------------------------------------------------------

export async function recordImportJob(
  db: Database,
  organizationId: OrganizationId,
  input: {
    userId: string | null;
    filename?: string | null;
    total: number;
    inserted: number;
    updated: number;
    skipped: number;
    invalid: number;
    suppressed: number;
    errors: { row: number; message: string }[];
    consentAttestedAt: Date;
  },
) {
  const [row] = await db
    .insert(importJobs)
    .values({
      organizationId,
      consentAttested: true,
      ...input,
      filename: input.filename ?? null,
    })
    .returning();
  return row!;
}

export async function listImportJobs(
  db: Database,
  organizationId: OrganizationId,
  limit = 20,
) {
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.organizationId, organizationId))
    .orderBy(desc(importJobs.createdAt))
    .limit(limit);
}
