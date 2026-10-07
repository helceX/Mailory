import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { compileSegment, escapeLike, type SegmentNodeInput } from "../segments";
import { contactTags, contacts, tags } from "../schema/index";

export type ContactFilter = {
  q?: string;
  status?: string;
  consentStatus?: string;
  listId?: string;
  tagId?: string;
  /** A resolved (validated) segment definition. */
  segment?: SegmentNodeInput;
};
export type ContactTarget =
  | { ids: string[] }
  | { emails: string[] }
  | { filter: ContactFilter };

/**
 * Every read and bulk write below funnels through this predicate, so the tenant condition
 * and the filter semantics live in exactly one place.
 */
export function contactWhere(
  organizationId: OrganizationId,
  filter: ContactFilter = {},
): SQL {
  const conditions: (SQL | undefined)[] = [eq(contacts.organizationId, organizationId)];
  if (filter.status) conditions.push(eq(contacts.status, filter.status));
  if (filter.consentStatus)
    conditions.push(eq(contacts.consentStatus, filter.consentStatus));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    conditions.push(
      or(
        sql`${contacts.email} like ${pattern} escape '\\'`,
        ilike(contacts.firstName, pattern),
        ilike(contacts.lastName, pattern),
        ilike(contacts.company, pattern),
      ),
    );
  }
  if (filter.listId) {
    conditions.push(
      sql`exists (select 1 from list_contacts lc where lc.contact_id = ${contacts.id} and lc.organization_id = ${organizationId}::uuid and lc.list_id = ${filter.listId}::uuid)`,
    );
  }
  if (filter.tagId) {
    conditions.push(
      sql`exists (select 1 from contact_tags ct where ct.contact_id = ${contacts.id} and ct.organization_id = ${organizationId}::uuid and ct.tag_id = ${filter.tagId}::uuid)`,
    );
  }
  if (filter.segment) conditions.push(compileSegment(filter.segment, organizationId));
  return and(...conditions)!;
}

function targetWhere(organizationId: OrganizationId, target: ContactTarget): SQL {
  if ("ids" in target)
    return and(
      eq(contacts.organizationId, organizationId),
      inArray(contacts.id, target.ids),
    )!;
  if ("emails" in target)
    return and(
      eq(contacts.organizationId, organizationId),
      inArray(contacts.email, target.emails),
    )!;
  return contactWhere(organizationId, target.filter);
}

// ---- cursor pagination (keyset on created_at desc, id desc) -------------------------------------

/*
 * Postgres timestamps have microsecond precision; a JS Date only has milliseconds. Rows written by one
 * bulk INSERT share an identical created_at, so a cursor that round-trips through Date skips or repeats
 * them. The cursor therefore carries created_at as Postgres' own text rendering (`cursorTs`) and feeds it
 * straight back, preserving every microsecond.
 */
const CURSOR_TS =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(row: { cursorTs: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.cursorTs, row.id])).toString("base64url");
}
export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as [string, string];
    if (
      typeof createdAt !== "string" ||
      typeof id !== "string" ||
      !CURSOR_TS.test(createdAt) ||
      !CURSOR_ID.test(id)
    )
      return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

const withCursorTs = {
  ...getTableColumns(contacts),
  cursorTs: sql<string>`${contacts.createdAt}::text`,
};

export async function countContacts(
  db: Database,
  organizationId: OrganizationId,
  filter: ContactFilter = {},
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(contactWhere(organizationId, filter));
  return row?.n ?? 0;
}

export async function listContacts(
  db: Database,
  organizationId: OrganizationId,
  options: { filter?: ContactFilter; cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const where = and(
    contactWhere(organizationId, options.filter),
    cursor
      ? sql`(${contacts.createdAt}, ${contacts.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : undefined,
  );
  const rows = await db
    .select(withCursorTs)
    .from(contacts)
    .where(where)
    .orderBy(desc(contacts.createdAt), desc(contacts.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Tag chips for the visible page only (one extra query, not N+1).
  const tagRows = page.length
    ? await db
        .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(
          and(
            eq(contactTags.organizationId, organizationId),
            inArray(
              contactTags.contactId,
              page.map((r) => r.id),
            ),
          ),
        )
    : [];
  const byContact = new Map<string, { id: string; name: string }[]>();
  for (const t of tagRows)
    byContact.set(t.contactId, [
      ...(byContact.get(t.contactId) ?? []),
      { id: t.id, name: t.name },
    ]);

  return {
    rows: page.map(({ cursorTs: _cursorTs, ...r }) => ({
      ...r,
      tags: byContact.get(r.id) ?? [],
    })),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  };
}

export async function getContact(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, id)))
    .limit(1);
  if (!contact) return null;
  const [tagRows, listRows] = await Promise.all([
    db
      .select({ id: tags.id, name: tags.name })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(
        and(
          eq(contactTags.organizationId, organizationId),
          eq(contactTags.contactId, id),
        ),
      ),
    db.execute<{ id: string; name: string }>(
      sql`select l.id, l.name from list_contacts lc join lists l on l.id = lc.list_id where lc.organization_id = ${organizationId}::uuid and lc.contact_id = ${id}::uuid order by l.name`,
    ),
  ]);
  return { ...contact, tags: tagRows, lists: listRows.rows };
}

export type ContactValues = Partial<typeof contacts.$inferInsert>;

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Returns null when the email already exists in this organization. */
export async function createContact(
  db: Database,
  organizationId: OrganizationId,
  values: ContactValues & { email: string },
) {
  try {
    const [row] = await db
      .insert(contacts)
      .values({ ...values, organizationId, email: values.email.toLowerCase() })
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

export async function updateContact(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  patch: ContactValues,
): Promise<"duplicate" | "not_found" | typeof contacts.$inferSelect> {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  try {
    const [row] = await db
      .update(contacts)
      .set({ ...clean, updatedAt: new Date() })
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, id)))
      .returning();
    return row ?? "not_found";
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

export async function deleteContacts(
  db: Database,
  organizationId: OrganizationId,
  target: ContactTarget,
) {
  const rows = await db
    .delete(contacts)
    .where(targetWhere(organizationId, target))
    .returning({ id: contacts.id });
  return rows.length;
}

export async function setContactsStatus(
  db: Database,
  organizationId: OrganizationId,
  target: ContactTarget,
  status: string,
) {
  const now = new Date();
  const rows = await db
    .update(contacts)
    .set({
      status,
      updatedAt: now,
      ...(status === "unsubscribed"
        ? { unsubscribedAt: now, consentStatus: "withdrawn" }
        : {}),
    })
    .where(targetWhere(organizationId, target))
    .returning({ id: contacts.id });
  return rows.length;
}

/** Foreign list ids are ignored: the join requires the list to belong to the same organization. */
export async function addContactsToList(
  db: Database,
  organizationId: OrganizationId,
  listId: string,
  target: ContactTarget,
) {
  const result = await db.execute(sql`
    insert into list_contacts (list_id, contact_id, organization_id)
    select l.id, contacts.id, contacts.organization_id
    from contacts join lists l on l.id = ${listId}::uuid and l.organization_id = ${organizationId}::uuid
    where ${targetWhere(organizationId, target)}
    on conflict do nothing`);
  return result.rowCount ?? 0;
}

export async function removeContactsFromList(
  db: Database,
  organizationId: OrganizationId,
  listId: string,
  target: ContactTarget,
) {
  const result = await db.execute(sql`
    delete from list_contacts
    where organization_id = ${organizationId}::uuid and list_id = ${listId}::uuid
      and contact_id in (select contacts.id from contacts where ${targetWhere(organizationId, target)})`);
  return result.rowCount ?? 0;
}

export async function addTagToContacts(
  db: Database,
  organizationId: OrganizationId,
  tagId: string,
  target: ContactTarget,
) {
  const result = await db.execute(sql`
    insert into contact_tags (tag_id, contact_id, organization_id)
    select t.id, contacts.id, contacts.organization_id
    from contacts join tags t on t.id = ${tagId}::uuid and t.organization_id = ${organizationId}::uuid
    where ${targetWhere(organizationId, target)}
    on conflict do nothing`);
  return result.rowCount ?? 0;
}

export async function removeTagFromContacts(
  db: Database,
  organizationId: OrganizationId,
  tagId: string,
  target: ContactTarget,
) {
  const result = await db.execute(sql`
    delete from contact_tags
    where organization_id = ${organizationId}::uuid and tag_id = ${tagId}::uuid
      and contact_id in (select contacts.id from contacts where ${targetWhere(organizationId, target)})`);
  return result.rowCount ?? 0;
}

// ---- bulk import ----------------------------------------------------------------------------------

export type ImportRow = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  position?: string | null;
  website?: string | null;
  phone?: string | null;
  sector?: string | null;
  city?: string | null;
  source?: string | null;
  custom?: Record<string, string | number | boolean | null>;
};

/**
 * Upserts one batch. Emails must be unique within the batch (the service dedupes). New rows get
 * granted consent with the given provenance; existing rows NEVER have their status or consent
 * touched, and with `updateExisting` only non-empty incoming values overwrite.
 */
export async function upsertContactsBatch(
  db: Database,
  organizationId: OrganizationId,
  rows: ImportRow[],
  options: { updateExisting: boolean; consentSource: string; now: Date },
): Promise<{ inserted: number; updated: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0, skipped: 0 };
  const values = rows.map((r) => ({
    organizationId,
    email: r.email,
    firstName: r.firstName ?? null,
    lastName: r.lastName ?? null,
    company: r.company ?? null,
    position: r.position ?? null,
    website: r.website ?? null,
    phone: r.phone ?? null,
    sector: r.sector ?? null,
    city: r.city ?? null,
    source: r.source ?? "import",
    custom: r.custom ?? {},
    status: "subscribed",
    consentStatus: "granted",
    consentSource: options.consentSource,
    consentAt: options.now,
  }));

  if (!options.updateExisting) {
    const inserted = await db
      .insert(contacts)
      .values(values)
      .onConflictDoNothing({ target: [contacts.organizationId, contacts.email] })
      .returning({ id: contacts.id });
    return {
      inserted: inserted.length,
      updated: 0,
      skipped: rows.length - inserted.length,
    };
  }

  const merged = (column: string) =>
    sql.raw(`coalesce(nullif(excluded.${column}, ''), contacts.${column})`);
  const result = await db
    .insert(contacts)
    .values(values)
    .onConflictDoUpdate({
      target: [contacts.organizationId, contacts.email],
      set: {
        firstName: merged("first_name"),
        lastName: merged("last_name"),
        company: merged("company"),
        position: merged("position"),
        website: merged("website"),
        phone: merged("phone"),
        sector: merged("sector"),
        city: merged("city"),
        custom: sql`contacts.custom || excluded.custom`,
        updatedAt: options.now,
      },
    })
    // xmax = 0 only for freshly inserted rows
    .returning({ wasInserted: sql<boolean>`(xmax = 0)` });
  const inserted = result.filter((r) => r.wasInserted).length;
  return { inserted, updated: result.length - inserted, skipped: 0 };
}

/** Iterates every matching contact in stable batches (for export) without holding them all in memory. */
export async function* streamContacts(
  db: Database,
  organizationId: OrganizationId,
  filter: ContactFilter = {},
  batchSize = 1000,
) {
  let after: { createdAt: string; id: string } | null = null;
  for (;;) {
    const where = and(
      contactWhere(organizationId, filter),
      after
        ? sql`(${contacts.createdAt}, ${contacts.id}) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`
        : undefined,
    );
    const rows = await db
      .select(withCursorTs)
      .from(contacts)
      .where(where)
      .orderBy(asc(contacts.createdAt), asc(contacts.id))
      .limit(batchSize);
    if (rows.length === 0) return;
    yield rows.map(({ cursorTs: _cursorTs, ...r }) => r);
    const last = rows[rows.length - 1]!;
    after = { createdAt: last.cursorTs, id: last.id };
    if (rows.length < batchSize) return;
  }
}
