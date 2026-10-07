import {
  CSV_BOM,
  coerceCustomValue,
  coerceCustomValues,
  isValidEmail,
  normalizeEmail,
  parseCsv,
  suggestMapping,
  toCsvLine,
  type CustomValue,
  type Permission,
} from "@mailory/core";
import {
  addContactsToList,
  addSuppressions,
  addTagToContacts,
  countContacts,
  createContact,
  createContactField,
  createList,
  createSegment,
  createTag,
  deleteContactField,
  deleteContacts,
  deleteList,
  deleteSegment,
  deleteTag,
  findSuppressedEmails,
  getContact,
  getSegment,
  listContactFields,
  listContacts,
  listImportJobs,
  listLists,
  listSegments,
  listSuppressions,
  listTags,
  recordAudit,
  recordImportJob,
  removeContactsFromList,
  removeSuppression,
  removeTagFromContacts,
  setContactsStatus,
  setSegmentCount,
  streamContacts,
  updateContact,
  updateList,
  updateSegment,
  upsertContactsBatch,
  type ContactFilter,
  type ContactTarget,
  type Database,
  type ImportRow,
} from "@mailory/db";
import type {
  BulkAction,
  ContactFilterInput,
  ContactInput,
  ImportRunInput,
  SegmentDefinition,
} from "@mailory/validation";
import { authorize, type Actor } from "../org/service";

export type AudienceDeps = { db: Database; now?: () => Date };
type Code =
  | "forbidden"
  | "not_found"
  | "duplicate"
  | "suppressed"
  | "invalid"
  | "too_large";
export type Failure = { ok: false; code: Code; message?: string };
export type Ok<T = object> = { ok: true } & T;

const now = (d: AudienceDeps) => (d.now ?? (() => new Date()))();
const denied: Failure = { ok: false, code: "forbidden" };
const need = (actor: Actor, permission: Permission) => authorize(actor, permission);

export const MAX_IMPORT_ROWS = 50_000;
const IMPORT_BATCH = 1000;
const MAX_REPORTED_ERRORS = 50;

function audit(
  deps: AudienceDeps,
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

/** Turns the API filter (which may name a saved segment) into the repository filter. */
async function resolveFilter(
  deps: AudienceDeps,
  actor: Actor,
  input: ContactFilterInput = {},
): Promise<{ filter: ContactFilter } | Failure> {
  const { segmentId, ...rest } = input;
  if (!segmentId) return { filter: rest };
  const segment = await getSegment(deps.db, actor.organizationId, segmentId);
  if (!segment) return { ok: false, code: "not_found" };
  return { filter: { ...rest, segment: segment.definition as SegmentDefinition } };
}

// ---- contacts -------------------------------------------------------------------------------------

export async function searchContacts(
  deps: AudienceDeps,
  actor: Actor,
  input: { filter?: ContactFilterInput; cursor?: string; limit?: number },
) {
  if (!need(actor, "contacts:read")) return denied;
  const resolved = await resolveFilter(deps, actor, input.filter);
  if ("ok" in resolved) return resolved;
  const [page, total] = await Promise.all([
    listContacts(deps.db, actor.organizationId, {
      filter: resolved.filter,
      cursor: input.cursor,
      limit: input.limit,
    }),
    // The total is only needed on the first page; later pages reuse it client-side.
    input.cursor
      ? Promise.resolve(null)
      : countContacts(deps.db, actor.organizationId, resolved.filter),
  ]);
  return { ok: true as const, ...page, total };
}

export async function getContactDetail(deps: AudienceDeps, actor: Actor, id: string) {
  if (!need(actor, "contacts:read")) return denied;
  const contact = await getContact(deps.db, actor.organizationId, id);
  return contact
    ? { ok: true as const, contact }
    : ({ ok: false, code: "not_found" } as Failure);
}

async function prepareCustom(
  deps: AudienceDeps,
  actor: Actor,
  custom: ContactInput["custom"],
) {
  if (!custom || Object.keys(custom).length === 0)
    return { ok: true as const, value: undefined };
  const fields = await listContactFields(deps.db, actor.organizationId);
  const result = coerceCustomValues(fields, custom);
  return result.ok
    ? { ok: true as const, value: result.value }
    : ({ ok: false, code: "invalid", message: result.error } as Failure);
}

export async function createContactFor(
  deps: AudienceDeps,
  actor: Actor,
  input: ContactInput,
): Promise<
  Ok<{ contact: NonNullable<Awaited<ReturnType<typeof createContact>>> }> | Failure
> {
  if (!need(actor, "contacts:write")) return denied;
  input = { ...input, email: normalizeEmail(input.email) }; // never rely on the caller having normalized
  if (
    (await findSuppressedEmails(deps.db, actor.organizationId, [input.email])).size > 0
  ) {
    return {
      ok: false,
      code: "suppressed",
      message: "Bu adres bastırma listesinde; contact olarak eklenemez.",
    };
  }
  const custom = await prepareCustom(deps, actor, input.custom);
  if (!("value" in custom)) return custom;

  const granted = input.consentStatus === "granted";
  const contact = await createContact(deps.db, actor.organizationId, {
    ...input,
    custom: custom.value,
    source: input.source ?? "manual",
    consentSource: input.consentSource ?? (granted ? "manual" : null),
    consentAt: granted ? now(deps) : null,
  });
  return contact
    ? { ok: true, contact }
    : { ok: false, code: "duplicate", message: "Bu e-posta adresi zaten kayıtlı." };
}

export async function updateContactFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
  patch: Partial<ContactInput>,
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  if (patch.email) patch = { ...patch, email: normalizeEmail(patch.email) };
  const existing = await getContact(deps.db, actor.organizationId, id);
  if (!existing) return { ok: false, code: "not_found" };

  // Re-subscribing or moving to an address that is suppressed would defeat the suppression list.
  const emailToCheck = patch.email ?? existing.email;
  const becomingSubscribed =
    patch.status === "subscribed" && existing.status !== "subscribed";
  if ((patch.email && patch.email !== existing.email) || becomingSubscribed) {
    if (
      (await findSuppressedEmails(deps.db, actor.organizationId, [emailToCheck])).size >
      0
    ) {
      return {
        ok: false,
        code: "suppressed",
        message:
          "Bu adres bastırma listesinde. Önce listeden çıkarılmalı (yönetici yetkisi gerekir).",
      };
    }
  }

  const { custom: customInput, ...rest } = patch;
  const custom = await prepareCustom(deps, actor, customInput);
  if (!("value" in custom)) return custom;

  const at = now(deps);
  const result = await updateContact(deps.db, actor.organizationId, id, {
    ...rest,
    ...(custom.value ? { custom: { ...existing.custom, ...custom.value } } : {}),
    ...(patch.status === "unsubscribed" ? { unsubscribedAt: at } : {}),
    ...(patch.consentStatus === "granted" && existing.consentStatus !== "granted"
      ? { consentAt: at }
      : {}),
  });
  if (result === "duplicate")
    return {
      ok: false,
      code: "duplicate",
      message: "Bu e-posta adresi zaten kayıtlı.",
    };
  if (result === "not_found") return { ok: false, code: "not_found" };
  return { ok: true };
}

export async function bulkAction(
  deps: AudienceDeps,
  actor: Actor,
  request: BulkAction,
): Promise<Ok<{ affected: number }> | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  let target: ContactTarget;
  if ("ids" in request) target = { ids: request.ids };
  else {
    const resolved = await resolveFilter(deps, actor, request.filter);
    if ("ok" in resolved) return resolved;
    target = { filter: resolved.filter };
  }

  let affected = 0;
  switch (request.action) {
    case "delete":
      affected = await deleteContacts(deps.db, actor.organizationId, target);
      await audit(deps, actor, "contacts.bulk_deleted", "contact", null, {
        count: affected,
        scope: "ids" in request ? "ids" : "filter",
      });
      break;
    case "set_status": {
      if (request.status === "subscribed") {
        return {
          ok: false,
          code: "invalid",
          message:
            "Toplu olarak 'abone' durumuna alma desteklenmiyor; izin kaydı gerektirir.",
        };
      }
      affected = await setContactsStatus(
        deps.db,
        actor.organizationId,
        target,
        request.status,
      );
      break;
    }
    case "add_to_list":
      affected = await addContactsToList(
        deps.db,
        actor.organizationId,
        request.listId,
        target,
      );
      break;
    case "remove_from_list":
      affected = await removeContactsFromList(
        deps.db,
        actor.organizationId,
        request.listId,
        target,
      );
      break;
    case "add_tag":
      affected = await addTagToContacts(
        deps.db,
        actor.organizationId,
        request.tagId,
        target,
      );
      break;
    case "remove_tag":
      affected = await removeTagFromContacts(
        deps.db,
        actor.organizationId,
        request.tagId,
        target,
      );
      break;
  }
  return { ok: true, affected };
}

// ---- export ---------------------------------------------------------------------------------------

const EXPORT_COLUMNS = [
  ["email", "E-posta"],
  ["firstName", "Ad"],
  ["lastName", "Soyad"],
  ["company", "Şirket"],
  ["position", "Pozisyon"],
  ["website", "Web sitesi"],
  ["phone", "Telefon"],
  ["sector", "Sektör"],
  ["city", "Şehir"],
  ["status", "Durum"],
  ["consentStatus", "İzin durumu"],
  ["consentSource", "İzin kaynağı"],
  ["consentAt", "İzin tarihi"],
  ["unsubscribedAt", "Abonelikten çıkış tarihi"],
  ["source", "Kaynak"],
  ["createdAt", "Eklenme tarihi"],
] as const;

/** Authorizes, audits (exports are a data-exfiltration risk), then returns a lazy CSV stream. */
export async function exportContacts(
  deps: AudienceDeps,
  actor: Actor,
  input: ContactFilterInput = {},
) {
  if (!need(actor, "contacts:export")) return denied;
  const resolved = await resolveFilter(deps, actor, input);
  if ("ok" in resolved) return resolved;
  const fields = await listContactFields(deps.db, actor.organizationId);
  const filter = resolved.filter;
  const count = await countContacts(deps.db, actor.organizationId, filter);
  await audit(deps, actor, "contacts.exported", "contact", null, {
    count,
    filter: input,
  });

  async function* lines() {
    yield CSV_BOM +
      toCsvLine([
        ...EXPORT_COLUMNS.map(([, label]) => label),
        ...fields.map((f) => f.label),
      ]);
    for await (const batch of streamContacts(deps.db, actor.organizationId, filter)) {
      for (const c of batch) {
        yield toCsvLine([
          ...EXPORT_COLUMNS.map(([key]) => c[key]),
          ...fields.map((f) => c.custom[f.key] ?? ""),
        ]);
      }
    }
  }
  return { ok: true as const, count, lines: lines() };
}

// ---- import ---------------------------------------------------------------------------------------

export async function previewImport(deps: AudienceDeps, actor: Actor, csv: string) {
  if (!need(actor, "contacts:write")) return denied;
  const parsed = parseCsv(csv);
  if (parsed.headers.length === 0)
    return {
      ok: false,
      code: "invalid",
      message: "Dosya boş veya okunamadı.",
    } as Failure;
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      code: "too_large",
      message: `Tek seferde en fazla ${MAX_IMPORT_ROWS.toLocaleString("tr-TR")} satır içe aktarılabilir.`,
    } as Failure;
  }
  const fields = await listContactFields(deps.db, actor.organizationId);
  return {
    ok: true as const,
    headers: parsed.headers,
    sample: parsed.rows.slice(0, 5),
    totalRows: parsed.rows.length,
    suggestedMapping: suggestMapping(parsed.headers, fields),
    customFields: fields.map((f) => ({ key: f.key, label: f.label })),
  };
}

const TEXT_TARGETS = {
  first_name: ["firstName", 80],
  last_name: ["lastName", 80],
  company: ["company", 120],
  position: ["position", 120],
  website: ["website", 200],
  phone: ["phone", 40],
  sector: ["sector", 80],
  city: ["city", 80],
  source: ["source", 80],
} as const;

export async function runImport(
  deps: AudienceDeps,
  actor: Actor,
  input: ImportRunInput,
) {
  if (!need(actor, "contacts:write")) return denied;
  const parsed = parseCsv(input.csv);
  if (parsed.headers.length === 0)
    return {
      ok: false,
      code: "invalid",
      message: "Dosya boş veya okunamadı.",
    } as Failure;
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      code: "too_large",
      message: `Tek seferde en fazla ${MAX_IMPORT_ROWS.toLocaleString("tr-TR")} satır içe aktarılabilir.`,
    } as Failure;
  }

  // Validate the mapping against the real header row and this organization's custom fields.
  const fields = await listContactFields(deps.db, actor.organizationId);
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const columnFor = new Map<string, number>(); // target → column index
  for (const [header, target] of Object.entries(input.mapping)) {
    const index = parsed.headers.indexOf(header);
    if (index === -1)
      return {
        ok: false,
        code: "invalid",
        message: `Eşlenen sütun dosyada yok: ${header}`,
      } as Failure;
    const valid =
      target === "email" ||
      target in TEXT_TARGETS ||
      (target.startsWith("custom:") && fieldByKey.has(target.slice(7)));
    if (!valid)
      return {
        ok: false,
        code: "invalid",
        message: `Geçersiz eşleme hedefi: ${target}`,
      } as Failure;
    if (columnFor.has(target))
      return {
        ok: false,
        code: "invalid",
        message: `"${target}" birden fazla sütuna eşlenemez.`,
      } as Failure;
    columnFor.set(target, index);
  }
  if (!columnFor.has("email"))
    return {
      ok: false,
      code: "invalid",
      message: "E-posta sütunu eşlenmeli.",
    } as Failure;

  const errors: { row: number; message: string }[] = [];
  const fail = (row: number, message: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message });
  };
  let invalid = 0;
  let duplicatesInFile = 0;
  const seen = new Set<string>();
  const valid: ImportRow[] = [];

  parsed.rows.forEach((cells, i) => {
    const rowNumber = i + 2; // header is row 1, matching what the user sees in a spreadsheet
    const email = normalizeEmail(cells[columnFor.get("email")!] ?? "");
    if (!isValidEmail(email)) {
      invalid++;
      fail(
        rowNumber,
        email ? `Geçersiz e-posta: ${email.slice(0, 60)}` : "E-posta boş",
      );
      return;
    }
    if (seen.has(email)) {
      duplicatesInFile++;
      return;
    }
    const row: ImportRow = { email };
    for (const [target, [prop, max]] of Object.entries(TEXT_TARGETS)) {
      const idx = columnFor.get(target);
      const raw = idx === undefined ? "" : (cells[idx] ?? "").trim();
      if (raw) (row as Record<string, unknown>)[prop] = raw.slice(0, max);
    }
    const custom: Record<string, CustomValue> = {};
    for (const [target, idx] of columnFor) {
      if (!target.startsWith("custom:")) continue;
      const field = fieldByKey.get(target.slice(7))!;
      const result = coerceCustomValue(field, cells[idx]);
      if (!result.ok) {
        invalid++;
        fail(rowNumber, result.error);
        return;
      }
      if (result.value !== null) custom[field.key] = result.value;
    }
    if (Object.keys(custom).length) row.custom = custom;
    seen.add(email);
    valid.push(row);
  });

  const at = now(deps);
  const consentSource = `import:${(input.filename ?? "csv").slice(0, 100)}`;
  let inserted = 0;
  let updated = 0;
  let skipped = duplicatesInFile;
  let suppressedCount = 0;
  const importedEmails: string[] = [];

  for (let start = 0; start < valid.length; start += IMPORT_BATCH) {
    const batch = valid.slice(start, start + IMPORT_BATCH);
    const suppressed = await findSuppressedEmails(
      deps.db,
      actor.organizationId,
      batch.map((r) => r.email),
    );
    const allowed = batch.filter((r) => !suppressed.has(r.email));
    suppressedCount += batch.length - allowed.length;
    const result = await upsertContactsBatch(deps.db, actor.organizationId, allowed, {
      updateExisting: input.updateExisting,
      consentSource,
      now: at,
    });
    inserted += result.inserted;
    updated += result.updated;
    skipped += result.skipped;
    importedEmails.push(...allowed.map((r) => r.email));
  }

  // Attach to the chosen list / tags: everyone valid in the file, including already-existing contacts.
  for (let start = 0; start < importedEmails.length; start += IMPORT_BATCH) {
    const target: ContactTarget = {
      emails: importedEmails.slice(start, start + IMPORT_BATCH),
    };
    if (input.listId)
      await addContactsToList(deps.db, actor.organizationId, input.listId, target);
    for (const tagId of input.tagIds ?? [])
      await addTagToContacts(deps.db, actor.organizationId, tagId, target);
  }

  const summary = {
    total: parsed.rows.length,
    inserted,
    updated,
    skipped,
    invalid,
    suppressed: suppressedCount,
  };
  const job = await recordImportJob(deps.db, actor.organizationId, {
    userId: actor.userId,
    filename: input.filename,
    errors,
    consentAttestedAt: at,
    ...summary,
  });
  await audit(deps, actor, "contacts.imported", "import_job", job.id, summary);
  return { ok: true as const, jobId: job.id, ...summary, errors };
}

export async function recentImports(deps: AudienceDeps, actor: Actor) {
  if (!need(actor, "contacts:read")) return denied;
  return {
    ok: true as const,
    jobs: await listImportJobs(deps.db, actor.organizationId),
  };
}

// ---- lists / tags / fields / segments -------------------------------------------------------------

export async function getLists(deps: AudienceDeps, actor: Actor) {
  return need(actor, "contacts:read")
    ? { ok: true as const, lists: await listLists(deps.db, actor.organizationId) }
    : denied;
}
export async function createListFor(
  deps: AudienceDeps,
  actor: Actor,
  input: { name: string; description?: string | null },
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  const list = await createList(deps.db, actor.organizationId, input);
  if (!list)
    return { ok: false, code: "duplicate", message: "Bu isimde bir liste zaten var." };
  await audit(deps, actor, "list.created", "list", list.id);
  return { ok: true, id: list.id };
}
export async function updateListFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
  input: { name: string; description?: string | null },
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  const result = await updateList(deps.db, actor.organizationId, id, input);
  if (result === "duplicate")
    return { ok: false, code: "duplicate", message: "Bu isimde bir liste zaten var." };
  return result === "not_found" ? { ok: false, code: "not_found" } : { ok: true };
}
export async function deleteListFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  if (!(await deleteList(deps.db, actor.organizationId, id)))
    return { ok: false, code: "not_found" };
  await audit(deps, actor, "list.deleted", "list", id);
  return { ok: true };
}

export async function getTags(deps: AudienceDeps, actor: Actor) {
  return need(actor, "contacts:read")
    ? { ok: true as const, tags: await listTags(deps.db, actor.organizationId) }
    : denied;
}
export async function createTagFor(
  deps: AudienceDeps,
  actor: Actor,
  name: string,
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  const tag = await createTag(deps.db, actor.organizationId, name);
  return tag
    ? { ok: true, id: tag.id }
    : { ok: false, code: "duplicate", message: "Bu isimde bir etiket zaten var." };
}
export async function deleteTagFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  return (await deleteTag(deps.db, actor.organizationId, id))
    ? { ok: true }
    : { ok: false, code: "not_found" };
}

export async function getFields(deps: AudienceDeps, actor: Actor) {
  return need(actor, "contacts:read")
    ? {
        ok: true as const,
        fields: await listContactFields(deps.db, actor.organizationId),
      }
    : denied;
}
export async function createFieldFor(
  deps: AudienceDeps,
  actor: Actor,
  input: { key: string; label: string; type: string; options?: string[] },
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  if (input.type === "select" && !(input.options && input.options.length > 0)) {
    return {
      ok: false,
      code: "invalid",
      message: "Seçim alanı için en az bir seçenek girin.",
    };
  }
  const field = await createContactField(deps.db, actor.organizationId, input);
  if (!field)
    return {
      ok: false,
      code: "duplicate",
      message: "Bu anahtarla bir alan zaten var.",
    };
  await audit(deps, actor, "contact_field.created", "contact_field", field.id, {
    key: field.key,
  });
  return { ok: true, id: field.id };
}
export async function deleteFieldFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  if (!(await deleteContactField(deps.db, actor.organizationId, id)))
    return { ok: false, code: "not_found" };
  await audit(deps, actor, "contact_field.deleted", "contact_field", id);
  return { ok: true };
}

export async function getSegments(deps: AudienceDeps, actor: Actor) {
  return need(actor, "contacts:read")
    ? { ok: true as const, segments: await listSegments(deps.db, actor.organizationId) }
    : denied;
}
export async function previewSegment(
  deps: AudienceDeps,
  actor: Actor,
  definition: SegmentDefinition,
) {
  if (!need(actor, "contacts:read")) return denied;
  const filter = { segment: definition };
  const [count, page] = await Promise.all([
    countContacts(deps.db, actor.organizationId, filter),
    listContacts(deps.db, actor.organizationId, { filter, limit: 5 }),
  ]);
  return {
    ok: true as const,
    count,
    sample: page.rows.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
    })),
  };
}
export async function createSegmentFor(
  deps: AudienceDeps,
  actor: Actor,
  input: { name: string; definition: SegmentDefinition },
): Promise<Ok<{ id: string; count: number }> | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  const segment = await createSegment(deps.db, actor.organizationId, {
    ...input,
    userId: actor.userId,
  });
  if (!segment)
    return {
      ok: false,
      code: "duplicate",
      message: "Bu isimde bir segment zaten var.",
    };
  const count = await countContacts(deps.db, actor.organizationId, {
    segment: input.definition,
  });
  await setSegmentCount(deps.db, actor.organizationId, segment.id, count);
  await audit(deps, actor, "segment.created", "segment", segment.id);
  return { ok: true, id: segment.id, count };
}
export async function updateSegmentFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
  input: { name: string; definition: SegmentDefinition },
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  const result = await updateSegment(deps.db, actor.organizationId, id, input);
  if (result === "duplicate")
    return {
      ok: false,
      code: "duplicate",
      message: "Bu isimde bir segment zaten var.",
    };
  if (result === "not_found") return { ok: false, code: "not_found" };
  await setSegmentCount(
    deps.db,
    actor.organizationId,
    id,
    await countContacts(deps.db, actor.organizationId, { segment: input.definition }),
  );
  return { ok: true };
}
export async function deleteSegmentFor(
  deps: AudienceDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  if (!(await deleteSegment(deps.db, actor.organizationId, id)))
    return { ok: false, code: "not_found" };
  await audit(deps, actor, "segment.deleted", "segment", id);
  return { ok: true };
}

// ---- suppression ----------------------------------------------------------------------------------

export async function getSuppressions(
  deps: AudienceDeps,
  actor: Actor,
  options: { q?: string; limit?: number; offset?: number },
) {
  return need(actor, "contacts:read")
    ? {
        ok: true as const,
        ...(await listSuppressions(deps.db, actor.organizationId, options)),
      }
    : denied;
}
export async function suppressEmails(
  deps: AudienceDeps,
  actor: Actor,
  input: { emails: string[]; reason: string },
): Promise<Ok<{ added: number; alreadyPresent: number }> | Failure> {
  if (!need(actor, "contacts:write")) return denied;
  const result = await addSuppressions(deps.db, actor.organizationId, {
    ...input,
    emails: input.emails.map(normalizeEmail),
    userId: actor.userId,
  });
  await audit(deps, actor, "suppression.added", "suppression", null, {
    count: result.added,
    reason: input.reason,
  });
  return { ok: true, ...result };
}
/** Lifting a suppression re-enables mailing someone who opted out or bounced — admin-only and audited. */
export async function liftSuppression(
  deps: AudienceDeps,
  actor: Actor,
  email: string,
): Promise<Ok | Failure> {
  if (!need(actor, "org:manage_settings")) return denied;
  if (!(await removeSuppression(deps.db, actor.organizationId, normalizeEmail(email))))
    return { ok: false, code: "not_found" };
  await audit(deps, actor, "suppression.removed", "suppression", null, {});
  return { ok: true };
}
