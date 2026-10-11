import { createHash } from "node:crypto";
import {
  DEFAULT_BRAND,
  CONTACT_MERGE_FIELDS,
  SYSTEM_MERGE_FIELDS,
  logoSrcFor,
  sniffImageType,
  type BrandKit,
  type EmailDoc,
  type Permission,
} from "@mailory/core";
import {
  countAssets,
  createAsset,
  createTemplate,
  getBrandKitRow,
  getTemplate,
  getTemplateVersion,
  listContactFields,
  listTemplateVersions,
  listTemplates,
  recordAudit,
  saveTemplateVersion,
  setTemplateArchived,
  upsertBrandKit,
  type Database,
} from "@mailory/db";
import {
  blankTemplate,
  buildMergeValues,
  findLibraryTemplate,
  renderEmail,
} from "@mailory/email";
import { emailDocSchema, type BrandKitInput } from "@mailory/validation";
import { enforce } from "../billing/enforce";
import { authorize, type Actor } from "../org/service";

export type TemplateDeps = { db: Database; appUrl: string };
type Code =
  | "forbidden"
  | "not_found"
  | "duplicate"
  | "invalid"
  | "conflict"
  | "too_large"
  | "plan_limit";
export type Failure = {
  ok: false;
  code: Code;
  message?: string;
  currentVersion?: number;
};
export type Ok<T = object> = { ok: true } & T;

const denied: Failure = { ok: false, code: "forbidden" };
const need = (actor: Actor, permission: Permission) => authorize(actor, permission);

export const MAX_ASSET_BYTES = 1_048_576;
// Count cap is only an abuse guard; bytes (below) and the plan's storage_mb are the real limits. 1000 fits the 131 ready packs (383 images).
export const MAX_ASSETS_PER_ORG = 1000;
export const MAX_ASSET_TOTAL_BYTES = 100 * 1024 * 1024;

function audit(
  deps: TemplateDeps,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}

// ---- brand kit -------------------------------------------------------------------------------------

export async function loadBrandKit(
  deps: TemplateDeps,
  actor: Actor,
): Promise<BrandKit> {
  const row = await getBrandKitRow(deps.db, actor.organizationId);
  if (!row) return DEFAULT_BRAND;
  return {
    logoAssetId: row.logoAssetId,
    primaryColor: row.primaryColor,
    textColor: row.textColor,
    backgroundColor: row.backgroundColor,
    linkColor: row.linkColor,
    buttonColor: row.buttonColor,
    buttonTextColor: row.buttonTextColor,
    font: row.font as BrandKit["font"],
    buttonRadius: row.buttonRadius,
    footerText: row.footerText,
    socialLinks: row.socialLinks as BrandKit["socialLinks"],
  };
}

export async function getBrandKit(deps: TemplateDeps, actor: Actor) {
  if (!need(actor, "templates:read")) return denied;
  const brand = await loadBrandKit(deps, actor);
  return {
    ok: true as const,
    brand,
    configured: Boolean(await getBrandKitRow(deps.db, actor.organizationId)),
  };
}

export async function saveBrandKit(
  deps: TemplateDeps,
  actor: Actor,
  input: BrandKitInput,
): Promise<Ok | Failure> {
  if (!need(actor, "brand:manage")) return denied;
  await upsertBrandKit(deps.db, actor.organizationId, {
    ...input,
    userId: actor.userId,
  });
  await audit(deps, actor, "brand_kit.updated", "brand_kit", null);
  return { ok: true };
}

// ---- assets ----------------------------------------------------------------------------------------

export async function uploadAsset(
  deps: TemplateDeps,
  actor: Actor,
  input: { bytes: Buffer; filename: string | null },
): Promise<Ok<{ id: string; url: string }> | Failure> {
  if (!need(actor, "templates:write")) return denied;
  if (input.bytes.length === 0)
    return { ok: false, code: "invalid", message: "Dosya boş." };
  if (input.bytes.length > MAX_ASSET_BYTES)
    return { ok: false, code: "too_large", message: "Görsel en fazla 1 MB olabilir." };
  const type = sniffImageType(input.bytes);
  if (!type)
    return {
      ok: false,
      code: "invalid",
      message: "Yalnızca PNG, JPEG, GIF veya WebP görseller yüklenebilir.",
    };

  const usage = await countAssets(deps.db, actor.organizationId);
  if (
    usage.count >= MAX_ASSETS_PER_ORG ||
    usage.bytes + input.bytes.length > MAX_ASSET_TOTAL_BYTES
  ) {
    return {
      ok: false,
      code: "too_large",
      message: "Görsel depolama sınırına ulaşıldı.",
    };
  }
  const limited = await enforce(
    deps.db,
    actor.organizationId,
    "storage_mb",
    Math.ceil(input.bytes.length / 1_048_576),
  );
  if (limited) return limited;
  const asset = await createAsset(deps.db, actor.organizationId, {
    contentType: type,
    size: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    filename: input.filename
      ? input.filename.replace(/[^\w.\- ]/g, "_").slice(0, 120)
      : null,
    data: input.bytes,
    userId: actor.userId,
  });
  return { ok: true, id: asset.id, url: `/a/${asset.id}` };
}

// ---- templates -------------------------------------------------------------------------------------

export async function listTemplatesFor(
  deps: TemplateDeps,
  actor: Actor,
  options: { archived?: boolean } = {},
) {
  if (!need(actor, "templates:read")) return denied;
  return {
    ok: true as const,
    templates: await listTemplates(deps.db, actor.organizationId, options),
  };
}

export async function createTemplateFor(
  deps: TemplateDeps,
  actor: Actor,
  input: { name: string; category: string; libraryKey?: string },
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "templates:write")) return denied;
  const brand = await loadBrandKit(deps, actor);
  const library = input.libraryKey ? findLibraryTemplate(input.libraryKey) : null;
  if (input.libraryKey && !library)
    return { ok: false, code: "not_found", message: "Şablon kütüphanede bulunamadı." };
  const doc = library ? library.build(brand) : blankTemplate(brand);
  const valid = emailDocSchema.safeParse(doc);
  if (!valid.success)
    return { ok: false, code: "invalid", message: "Şablon oluşturulamadı." };

  const created = await createTemplate(deps.db, actor.organizationId, {
    name: input.name,
    category: library && input.category === "other" ? library.category : input.category,
    doc: valid.data,
    userId: actor.userId,
    sourceLibraryKey: library?.key ?? null,
  });
  if (!created)
    return { ok: false, code: "duplicate", message: "Bu isimde bir şablon zaten var." };
  await audit(deps, actor, "template.created", "template", created.template.id, {
    library: library?.key ?? null,
  });
  return { ok: true, id: created.template.id };
}

export async function getTemplateFor(deps: TemplateDeps, actor: Actor, id: string) {
  if (!need(actor, "templates:read")) return denied;
  const row = await getTemplate(deps.db, actor.organizationId, id);
  if (!row) return { ok: false, code: "not_found" } as Failure;
  const doc = emailDocSchema.safeParse(row.version.doc);
  if (!doc.success)
    return {
      ok: false,
      code: "invalid",
      message: "Şablon içeriği okunamadı.",
    } as Failure;
  return {
    ok: true as const,
    template: row.template,
    version: row.version.version,
    doc: doc.data as EmailDoc,
  };
}

export async function saveTemplateFor(
  deps: TemplateDeps,
  actor: Actor,
  id: string,
  input: {
    doc: unknown;
    name?: string;
    category?: string;
    note?: string;
    expectedVersion?: number;
  },
): Promise<Ok<{ version: number }> | Failure> {
  if (!need(actor, "templates:write")) return denied;
  const valid = emailDocSchema.safeParse(input.doc);
  if (!valid.success)
    return {
      ok: false,
      code: "invalid",
      message: valid.error.issues[0]?.message ?? "Geçersiz içerik.",
    };
  const result = await saveTemplateVersion(deps.db, actor.organizationId, id, {
    ...input,
    doc: valid.data,
    userId: actor.userId,
  });
  switch (result.status) {
    case "ok":
      return { ok: true, version: result.version };
    case "not_found":
      return { ok: false, code: "not_found" };
    case "duplicate":
      return {
        ok: false,
        code: "duplicate",
        message: "Bu isimde bir şablon zaten var.",
      };
    case "conflict":
      return {
        ok: false,
        code: "conflict",
        currentVersion: result.currentVersion,
        message:
          "Bu şablon siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyip değişikliklerinizi yeniden uygulayın.",
      };
  }
}

export async function listVersionsFor(deps: TemplateDeps, actor: Actor, id: string) {
  if (!need(actor, "templates:read")) return denied;
  if (!(await getTemplate(deps.db, actor.organizationId, id)))
    return { ok: false, code: "not_found" } as Failure;
  return {
    ok: true as const,
    versions: await listTemplateVersions(deps.db, actor.organizationId, id),
  };
}

/** Restoring never rewrites history: it appends the old content as a new version. */
export async function restoreVersionFor(
  deps: TemplateDeps,
  actor: Actor,
  id: string,
  versionId: string,
): Promise<Ok<{ version: number }> | Failure> {
  if (!need(actor, "templates:write")) return denied;
  const old = await getTemplateVersion(deps.db, actor.organizationId, id, versionId);
  if (!old) return { ok: false, code: "not_found" };
  const result = await saveTemplateFor(deps, actor, id, {
    doc: old.doc,
    note: `Sürüm ${old.version} geri yüklendi`,
  });
  if (result.ok)
    await audit(deps, actor, "template.version_restored", "template", id, {
      restoredVersion: old.version,
    });
  return result;
}

export async function duplicateTemplateFor(
  deps: TemplateDeps,
  actor: Actor,
  id: string,
  name: string,
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "templates:write")) return denied;
  const source = await getTemplate(deps.db, actor.organizationId, id);
  if (!source) return { ok: false, code: "not_found" };
  const created = await createTemplate(deps.db, actor.organizationId, {
    name,
    category: source.template.category,
    doc: source.version.doc,
    userId: actor.userId,
    sourceLibraryKey: source.template.sourceLibraryKey,
    note: `“${source.template.name}” şablonundan kopyalandı`,
  });
  if (!created)
    return { ok: false, code: "duplicate", message: "Bu isimde bir şablon zaten var." };
  await audit(deps, actor, "template.duplicated", "template", created.template.id, {
    sourceId: id,
  });
  return { ok: true, id: created.template.id };
}

export async function archiveTemplateFor(
  deps: TemplateDeps,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Ok | Failure> {
  if (!need(actor, "templates:write")) return denied;
  const result = await setTemplateArchived(deps.db, actor.organizationId, id, archived);
  if (result === "duplicate")
    return {
      ok: false,
      code: "duplicate",
      message:
        "Aynı isimde etkin bir şablon var; geri yüklemeden önce birini yeniden adlandırın.",
    };
  if (result === "not_found") return { ok: false, code: "not_found" };
  await audit(
    deps,
    actor,
    archived ? "template.archived" : "template.restored",
    "template",
    id,
  );
  return { ok: true };
}

// ---- preview ---------------------------------------------------------------------------------------

/** Renders with a sample contact so authors see personalization; unknown fields come back for the editor to flag. */
export async function previewTemplate(deps: TemplateDeps, actor: Actor, doc: unknown) {
  if (!need(actor, "templates:read")) return denied;
  const valid = emailDocSchema.safeParse(doc);
  if (!valid.success)
    return {
      ok: false,
      code: "invalid",
      message: valid.error.issues[0]?.message ?? "Geçersiz içerik.",
    } as Failure;

  const [brand, fields] = await Promise.all([
    loadBrandKit(deps, actor),
    listContactFields(deps.db, actor.organizationId),
  ]);
  const sample = Object.fromEntries(CONTACT_MERGE_FIELDS.map((f) => [f.key, f.sample]));
  const values = {
    ...buildMergeValues(
      {
        firstName: sample.first_name,
        lastName: sample.last_name,
        email: sample.email,
        company: sample.company,
        position: sample.position,
        city: sample.city,
        sector: sample.sector,
        custom: Object.fromEntries(fields.map((f) => [f.key, "Örnek"])),
      },
      {
        unsubscribeUrl: `${deps.appUrl}/unsubscribe/preview`,
        viewInBrowserUrl: `${deps.appUrl}/view/preview`,
        orgName: SYSTEM_MERGE_FIELDS.find((f) => f.key === "org_name")!.sample,
      },
    ),
  };
  const result = renderEmail(valid.data as EmailDoc, {
    values,
    appUrl: deps.appUrl,
    brandLogoUrl: logoSrcFor(brand) || undefined,
  });
  return {
    ok: true as const,
    html: result.html,
    text: result.text,
    unknownKeys: result.unknownKeys,
    warnings: result.warnings,
  };
}
