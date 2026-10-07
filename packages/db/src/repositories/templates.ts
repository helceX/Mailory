import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Database, OrganizationId } from "../index";
import { assets, brandKits, templateVersions, templates, users } from "../schema/index";

const MAX_VERSIONS = 50;
const isUnique = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

// ---- templates -------------------------------------------------------------------------------------

export async function createTemplate(
  db: Database,
  organizationId: OrganizationId,
  input: {
    name: string;
    category: string;
    doc: unknown;
    userId: string | null;
    sourceLibraryKey?: string | null;
    note?: string;
  },
) {
  try {
    return await db.transaction(async (tx) => {
      const [template] = await tx
        .insert(templates)
        .values({
          organizationId,
          name: input.name,
          category: input.category,
          sourceLibraryKey: input.sourceLibraryKey ?? null,
          createdByUserId: input.userId,
        })
        .returning();
      const [version] = await tx
        .insert(templateVersions)
        .values({
          templateId: template!.id,
          organizationId,
          version: 1,
          doc: input.doc,
          note: input.note ?? null,
          createdByUserId: input.userId,
        })
        .returning();
      await tx
        .update(templates)
        .set({ currentVersionId: version!.id })
        .where(eq(templates.id, template!.id));
      return {
        template: { ...template!, currentVersionId: version!.id },
        version: version!,
      };
    });
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

export async function listTemplates(
  db: Database,
  organizationId: OrganizationId,
  options: { archived?: boolean } = {},
) {
  return db
    .select({
      id: templates.id,
      name: templates.name,
      category: templates.category,
      sourceLibraryKey: templates.sourceLibraryKey,
      archivedAt: templates.archivedAt,
      updatedAt: templates.updatedAt,
      version: templateVersions.version,
    })
    .from(templates)
    .leftJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .where(
      and(
        eq(templates.organizationId, organizationId),
        options.archived
          ? isNotNull(templates.archivedAt)
          : isNull(templates.archivedAt),
      ),
    )
    .orderBy(desc(templates.updatedAt));
}

export async function getTemplate(
  db: Database,
  organizationId: OrganizationId,
  id: string,
) {
  const [row] = await db
    .select({ template: templates, version: templateVersions })
    .from(templates)
    .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .where(and(eq(templates.organizationId, organizationId), eq(templates.id, id)))
    .limit(1);
  return row ?? null;
}

export type SaveResult =
  | { status: "ok"; version: number }
  | { status: "not_found" }
  | { status: "conflict"; currentVersion: number }
  | { status: "duplicate" };

/**
 * Appends a new immutable version. The template row is locked for the duration, and `expectedVersion`
 * (the version the editor loaded) turns a lost update — two people saving over each other — into an
 * explicit conflict instead of silently discarding someone's work.
 */
export async function saveTemplateVersion(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  input: {
    doc: unknown;
    userId: string | null;
    name?: string;
    category?: string;
    note?: string;
    expectedVersion?: number;
  },
): Promise<SaveResult> {
  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: templates.id, currentVersionId: templates.currentVersionId })
        .from(templates)
        .where(and(eq(templates.organizationId, organizationId), eq(templates.id, id)))
        .for("update");
      if (!locked) return { status: "not_found" as const };
      const [latest] = await tx
        .select({
          version: sql<number>`coalesce(max(${templateVersions.version}), 0)::int`,
        })
        .from(templateVersions)
        .where(eq(templateVersions.templateId, id));
      const current = latest?.version ?? 0;
      if (input.expectedVersion !== undefined && input.expectedVersion !== current)
        return { status: "conflict" as const, currentVersion: current };

      const [version] = await tx
        .insert(templateVersions)
        .values({
          templateId: id,
          organizationId,
          version: current + 1,
          doc: input.doc,
          note: input.note ?? null,
          createdByUserId: input.userId,
        })
        .returning();
      await tx
        .update(templates)
        .set({
          currentVersionId: version!.id,
          updatedAt: new Date(),
          ...(input.name ? { name: input.name } : {}),
          ...(input.category ? { category: input.category } : {}),
        })
        .where(eq(templates.id, id));
      // Keep history bounded.
      await tx.execute(sql`
        delete from template_versions
        where template_id = ${id}::uuid and organization_id = ${organizationId}::uuid and version <= ${current + 1 - MAX_VERSIONS}
          and id <> ${version!.id}::uuid`);
      return { status: "ok" as const, version: version!.version };
    });
  } catch (error) {
    if (isUnique(error)) return { status: "duplicate" };
    throw error;
  }
}

export async function listTemplateVersions(
  db: Database,
  organizationId: OrganizationId,
  templateId: string,
) {
  return db
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      note: templateVersions.note,
      createdAt: templateVersions.createdAt,
      authorName: sql<
        string | null
      >`nullif(trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')), '')`,
    })
    .from(templateVersions)
    .leftJoin(users, eq(users.id, templateVersions.createdByUserId))
    .where(
      and(
        eq(templateVersions.organizationId, organizationId),
        eq(templateVersions.templateId, templateId),
      ),
    )
    .orderBy(desc(templateVersions.version));
}

export async function getTemplateVersion(
  db: Database,
  organizationId: OrganizationId,
  templateId: string,
  versionId: string,
) {
  const [row] = await db
    .select()
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.organizationId, organizationId),
        eq(templateVersions.templateId, templateId),
        eq(templateVersions.id, versionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function setTemplateArchived(
  db: Database,
  organizationId: OrganizationId,
  id: string,
  archived: boolean,
) {
  try {
    const rows = await db
      .update(templates)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(templates.organizationId, organizationId), eq(templates.id, id)))
      .returning({ id: templates.id });
    return rows.length ? ("ok" as const) : ("not_found" as const);
  } catch (error) {
    // Restoring can collide with a live template that took the name in the meantime.
    if (isUnique(error)) return "duplicate" as const;
    throw error;
  }
}

export async function listBeforeDate(
  db: Database,
  organizationId: OrganizationId,
  before: Date,
) {
  return db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.organizationId, organizationId),
        lt(templates.updatedAt, before),
      ),
    )
    .orderBy(asc(templates.updatedAt));
}

// ---- brand kit -------------------------------------------------------------------------------------

export async function getBrandKitRow(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select()
    .from(brandKits)
    .where(eq(brandKits.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

export async function upsertBrandKit(
  db: Database,
  organizationId: OrganizationId,
  input: {
    logoAssetId: string | null;
    primaryColor: string;
    textColor: string;
    backgroundColor: string;
    linkColor: string;
    buttonColor: string;
    buttonTextColor: string;
    font: string;
    buttonRadius: number;
    footerText: string;
    socialLinks: { network: string; url: string }[];
    userId: string | null;
  },
) {
  const { userId, ...values } = input;
  // A logo must be an asset of THIS organization; a foreign asset id is dropped, never linked.
  let logoAssetId = values.logoAssetId;
  if (logoAssetId) {
    const [own] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.organizationId, organizationId), eq(assets.id, logoAssetId)))
      .limit(1);
    if (!own) logoAssetId = null;
  }
  const row = {
    ...values,
    logoAssetId,
    updatedByUserId: userId,
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(brandKits)
    .values({ organizationId, ...row })
    .onConflictDoUpdate({ target: brandKits.organizationId, set: row })
    .returning();
  return saved!;
}

// ---- assets ----------------------------------------------------------------------------------------

export async function createAsset(
  db: Database,
  organizationId: OrganizationId,
  input: {
    contentType: string;
    size: number;
    sha256: string;
    filename: string | null;
    data: Buffer;
    userId: string | null;
  },
) {
  const { userId, ...rest } = input;
  const [row] = await db
    .insert(assets)
    .values({ organizationId, createdByUserId: userId, ...rest })
    .returning({ id: assets.id, size: assets.size, contentType: assets.contentType });
  return row!;
}

export async function countAssets(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${assets.size}), 0)::bigint::float8`,
    })
    .from(assets)
    .where(eq(assets.organizationId, organizationId));
  return { count: row?.n ?? 0, bytes: Number(row?.bytes ?? 0) };
}

/** Public by design: an unguessable id is the credential, exactly like any image URL embedded in an email. */
export async function getAssetPublic(db: Database, id: string) {
  const [row] = await db
    .select({
      contentType: assets.contentType,
      data: assets.data,
      sha256: assets.sha256,
    })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  return row ?? null;
}
