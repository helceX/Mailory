import { unzipSync } from "fflate";
import { emailDocSchema } from "@mailory/validation";
import { LIMITS } from "@mailory/core";
import { createTemplate, recordAudit } from "@mailory/db";
import {
  blankTemplate,
  ensureUnsubscribe,
  extractParts,
  findLocalRefs,
  mapMergeTags,
  replaceLocalRefs,
  resolveArchivePath,
  sanitizeRawCss,
  sanitizeRawEmailHtml,
} from "@mailory/email";
import { authorize, type Actor } from "../org/service";
import {
  loadBrandKit,
  uploadAsset,
  type Failure,
  type Ok,
  type TemplateDeps,
} from "./service";

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_IMAGES = 60;
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const HTML_FILE = /\.html?$/i;

export type ImportInput = {
  name: string;
  category: string;
  filename: string;
  bytes: Buffer;
  /** Which HTML file inside a ZIP to use (when the archive holds several layouts). */
  entry?: string;
};
export type ImportResult =
  | Ok<{ id: string; warnings: string[] }>
  | Ok<{ choices: string[] }>
  | Failure;

const fail = (code: Failure["code"], message: string): Failure => ({
  ok: false,
  code,
  message,
});

function readArchive(
  bytes: Buffer,
): { files: Record<string, Uint8Array>; failure?: undefined } | { failure: Failure } {
  let entries = 0;
  let total = 0;
  try {
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        if (++entries > MAX_ENTRIES) throw new Error("too_many");
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("too_big");
        if (f.name.startsWith("__MACOSX/") || f.name.split("/").pop()?.startsWith("."))
          return false;
        return HTML_FILE.test(f.name) || IMG.test(f.name);
      },
    });
    return { files };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "too_many" || reason === "too_big")
      return {
        failure: fail("too_large", "Arşiv çok büyük veya çok fazla dosya içeriyor."),
      } as const;
    return { failure: fail("invalid", "ZIP dosyası okunamadı.") } as const;
  }
}

/** Picks the main HTML file: an explicit choice, else index.html at the shallowest depth, else the only candidate. */
function pickEntry(paths: string[], wanted?: string): string | string[] | null {
  if (paths.length === 0) return null;
  if (wanted) return paths.includes(wanted) ? wanted : null;
  if (paths.length === 1) return paths[0]!;
  const depth = (p: string) => p.split("/").length;
  const min = Math.min(...paths.map(depth));
  const shallow = paths.filter((p) => depth(p) === min);
  const index = shallow.filter((p) => /(^|\/)index\.html?$/i.test(p));
  if (index.length === 1) return index[0]!;
  if (shallow.length === 1) return shallow[0]!;
  return paths.sort();
}

/**
 * Imports a purchased/third-party HTML email (a single .html or a ZIP with images) as a new template. The result is
 * stored as a sanitized raw-HTML document: scripts/forms/handlers are gone, local images become our own assets,
 * other tools' merge tags are translated and an unsubscribe link is guaranteed. See docs/MAILORY_DECISIONS.md D-102.
 */
export async function importHtmlTemplateFor(
  deps: TemplateDeps,
  actor: Actor,
  input: ImportInput,
): Promise<ImportResult> {
  if (!authorize(actor, "templates:write")) return { ok: false, code: "forbidden" };
  const name = input.name.trim();
  if (!name || name.length > 120)
    return fail("invalid", "Şablon adı gerekli (en fazla 120 karakter).");
  if (input.bytes.length === 0) return fail("invalid", "Dosya boş.");
  if (input.bytes.length > MAX_IMPORT_BYTES)
    return fail("too_large", "Dosya en fazla 15 MB olabilir.");

  const warnings: string[] = [];
  const isZip = input.bytes[0] === 0x50 && input.bytes[1] === 0x4b;
  let htmlPath = input.filename;
  let source: string;
  let files: Record<string, Uint8Array> = {};
  if (isZip) {
    const archive = readArchive(input.bytes);
    if (archive.failure) return archive.failure;
    files = archive.files;
    const picked = pickEntry(
      Object.keys(files).filter((p) => HTML_FILE.test(p)),
      input.entry,
    );
    if (picked === null) return fail("invalid", "Arşivde HTML dosyası bulunamadı.");
    if (Array.isArray(picked)) return { ok: true, choices: picked };
    htmlPath = picked;
    source = Buffer.from(files[picked]!).toString("utf8");
  } else {
    if (!HTML_FILE.test(input.filename))
      return fail("invalid", "Yalnızca .html veya .zip dosyaları içe aktarılabilir.");
    source = input.bytes.toString("utf8").replace(/^\u{FEFF}/u, "");
  }

  const parts = extractParts(source);
  const mapped = mapMergeTags(parts.body);
  let body = mapped.html;
  let css = parts.css;
  if (mapped.mapped.length)
    warnings.push(
      `${mapped.mapped.length} birleştirme etiketi Mailory karşılığına çevrildi.`,
    );

  // ---- local images → our own assets --------------------------------------------------------------
  const refs = findLocalRefs(body, css);
  const urlFor = new Map<string, string>();
  const byPath = new Map<string, string>();
  let skipped = 0;
  for (const ref of refs) {
    const path = isZip ? resolveArchivePath(htmlPath, ref) : null;
    const data = path ? files[path] : undefined;
    if (!data || !IMG.test(path ?? "")) {
      skipped++;
      continue;
    }
    const known = byPath.get(path!);
    if (known) {
      urlFor.set(ref, known);
      continue;
    }
    if (byPath.size >= MAX_IMAGES) {
      skipped++;
      continue;
    }
    const up = await uploadAsset(deps, actor, {
      bytes: Buffer.from(data),
      filename: path!.split("/").pop() ?? null,
    });
    if (!up.ok) {
      skipped++;
      // Stop on a plan/storage failure: every further upload would fail the same way.
      if (up.code === "plan_limit" || up.code === "too_large")
        warnings.push(`Görsel yüklenemedi (${path}): ${up.message ?? up.code}`);
      continue;
    }
    byPath.set(path!, up.url);
    urlFor.set(ref, up.url);
  }
  body = replaceLocalRefs(body, urlFor);
  css = replaceLocalRefs(css, urlFor);
  if (urlFor.size) warnings.push(`${byPath.size} görsel Mailory'ye yüklendi.`);
  if (skipped)
    warnings.push(
      isZip
        ? `${skipped} görsel yüklenemedi veya atlandı (en fazla 1 MB; PNG/JPEG/GIF/WebP) — kaldırıldı.`
        : `${skipped} yerel görsel kaldırıldı: görselleri de içeren bir ZIP olarak yükleyin.`,
    );

  const unsub = ensureUnsubscribe(body);
  body = unsub.html;
  if (unsub.added)
    warnings.push(
      "Şablonda abonelikten çık bağlantısı yoktu; altına standart bir bağlantı eklendi.",
    );

  // Sanitize now (and again on every render). `appUrl: ""` keeps our own assets as `/a/<id>` paths.
  body = sanitizeRawEmailHtml(body, { appUrl: "" });
  css = sanitizeRawCss(css);
  if (body.length > LIMITS.maxRawHtmlLength || css.length > LIMITS.maxRawCssLength)
    return fail("too_large", "Şablon çok büyük (en fazla ~300 KB HTML).");
  if (!body.trim())
    return fail("invalid", "HTML içinde gösterilecek içerik bulunamadı.");
  warnings.push(
    "Outlook'a özel koşullu yorumlar (<!--[if mso]>) kaldırıldı; masaüstü Outlook'ta görünüm biraz farklı olabilir.",
  );

  const brand = await loadBrandKit(deps, actor);
  const doc = { ...blankTemplate(brand), blocks: [], raw: { html: body, css } };
  const valid = emailDocSchema.safeParse(doc);
  if (!valid.success)
    return fail("invalid", valid.error.issues[0]?.message ?? "Şablon oluşturulamadı.");

  const created = await createTemplate(deps.db, actor.organizationId, {
    name,
    category: input.category,
    doc: valid.data,
    userId: actor.userId,
    sourceLibraryKey: null,
  });
  if (!created) return fail("duplicate", "Bu isimde bir şablon zaten var.");
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "template.imported",
    entityType: "template",
    entityId: created.template.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { source: isZip ? "zip" : "html", images: byPath.size, skipped },
  });
  return { ok: true, id: created.template.id, warnings };
}
