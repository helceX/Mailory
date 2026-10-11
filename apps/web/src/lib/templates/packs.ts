import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { asOrganizationId, countAssets, memberships, templates } from "@mailory/db";
import type { Actor } from "../org/service";
import { importHtmlTemplateFor } from "./import";
import {
  MAX_ASSET_TOTAL_BYTES,
  MAX_ASSETS_PER_ORG,
  type TemplateDeps,
} from "./service";

/** manifest.json entry (templates/packs). `aciklama` is informational: templates have no description column. */
const entrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  zip: z.string().min(1),
  ad: z.string().trim().min(1).max(120),
  kategori: z.string().min(1),
  aciklama: z.string().optional(),
});
export type PackEntry = z.infer<typeof entrySchema>;

export type PackOutcome = {
  slug: string;
  name: string;
  status: "imported" | "skipped_exists" | "would_import" | "failed" | "stopped";
  images: number;
  warnings: string[];
  detail?: string;
};

export type ImportPacksOptions = {
  deps: TemplateDeps;
  organizationId: string;
  packsDir: string;
  only?: string[];
  dryRun?: boolean;
  log?: (line: string) => void;
};

export async function readManifest(packsDir: string): Promise<PackEntry[]> {
  const raw = JSON.parse(await readFile(join(packsDir, "manifest.json"), "utf8"));
  return z.array(entrySchema).parse(raw);
}

/** Counts PNG/JPG/GIF/WebP entries of a ZIP without unpacking it (central directory scan is enough for a report). */
function countZipImages(bytes: Buffer): number {
  let n = 0;
  unzipSync(new Uint8Array(bytes), {
    filter: (f) => {
      if (/\.(png|jpe?g|gif|webp)$/i.test(f.name) && !f.name.startsWith("__MACOSX/"))
        n++;
      return false;
    },
  });
  return n;
}

/** The organization's owner acts as the importer, so ownership, audit and RBAC are the ordinary ones. */
async function ownerActor(deps: TemplateDeps, organizationId: string): Promise<Actor> {
  const [m] = await deps.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  if (!m) throw new Error(`Organization ${organizationId} has no active owner.`);
  return {
    userId: m.userId,
    organizationId: asOrganizationId(organizationId),
    role: "owner",
    ip: null,
    userAgent: "template-pack-import",
  };
}

/**
 * Bulk-imports template packs through the ordinary `importHtmlTemplateFor` pipeline (sanitizing, merge-tag mapping,
 * unsubscribe guarantee, asset upload). Idempotent: a live template with the same name (case-insensitive) is skipped.
 * Image capacity is checked up front per pack so a pack is either imported with all its images or not at all.
 */
export async function importPacks(opts: ImportPacksOptions): Promise<PackOutcome[]> {
  const { deps, organizationId, packsDir, dryRun = false } = opts;
  const log = opts.log ?? (() => {});
  const root = resolve(packsDir);
  const manifest = await readManifest(root);
  const wanted = opts.only?.length ? new Set(opts.only) : null;
  if (wanted) {
    const known = new Set(manifest.map((e) => e.slug));
    const missing = [...wanted].filter((s) => !known.has(s));
    if (missing.length) throw new Error(`Unknown slug(s): ${missing.join(", ")}`);
  }
  const entries = manifest.filter((e) => !wanted || wanted.has(e.slug));

  const org = asOrganizationId(organizationId);
  const actor = await ownerActor(deps, organizationId);
  const existing = new Set(
    (
      await deps.db
        .select({ name: templates.name })
        .from(templates)
        .where(
          and(
            eq(templates.organizationId, organizationId),
            isNull(templates.archivedAt),
          ),
        )
    ).map((r) => r.name.toLowerCase()),
  );
  const usage = await countAssets(deps.db, org);
  let assetCount = usage.count;
  let assetBytes = usage.bytes;

  const out: PackOutcome[] = [];
  let stopped = false;
  for (const e of entries) {
    const base = { slug: e.slug, name: e.ad, images: 0, warnings: [] as string[] };
    if (existing.has(e.ad.toLowerCase())) {
      out.push({ ...base, status: "skipped_exists" });
      log(`skip     ${e.slug} (exists)`);
      continue;
    }
    const zipPath = resolve(root, e.zip);
    if (!zipPath.startsWith(root + sep)) {
      out.push({
        ...base,
        status: "failed",
        detail: "zip path escapes the packs directory",
      });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(zipPath);
    } catch {
      out.push({ ...base, status: "failed", detail: `cannot read ${e.zip}` });
      log(`FAIL     ${e.slug}: zip not found`);
      continue;
    }
    const images = countZipImages(bytes);
    if (
      stopped ||
      assetCount + images > MAX_ASSETS_PER_ORG ||
      assetBytes + bytes.length > MAX_ASSET_TOTAL_BYTES
    ) {
      stopped = true; // keep the order deterministic: nothing after the first pack that does not fit
      out.push({
        ...base,
        images,
        status: "stopped",
        detail: `image capacity reached (${assetCount}/${MAX_ASSETS_PER_ORG} assets used, pack needs ${images})`,
      });
      log(`STOP     ${e.slug}: image capacity`);
      continue;
    }
    if (dryRun) {
      assetCount += images;
      assetBytes += bytes.length;
      out.push({ ...base, images, status: "would_import" });
      log(`dry-run  ${e.slug} (${images} images)`);
      continue;
    }
    const r = await importHtmlTemplateFor(deps, actor, {
      name: e.ad,
      category: e.kategori,
      filename: `${e.slug}.zip`,
      bytes,
    });
    if (!r.ok) {
      out.push({
        ...base,
        images,
        status: r.code === "duplicate" ? "skipped_exists" : "failed",
        detail: r.message ?? r.code,
      });
      log(
        `${r.code === "duplicate" ? "skip    " : "FAIL    "} ${e.slug}: ${r.message ?? r.code}`,
      );
      continue;
    }
    if (!("id" in r)) {
      out.push({
        ...base,
        images,
        status: "failed",
        detail: "archive needs an entry choice",
      });
      continue;
    }
    assetCount += images;
    assetBytes += bytes.length;
    existing.add(e.ad.toLowerCase());
    out.push({ ...base, images, status: "imported", warnings: r.warnings });
    log(`imported ${e.slug} (${images} images)`);
  }
  return out;
}

/** Warnings every healthy import produces; anything else deserves a human look. */
export const EXPECTED_WARNING =
  /birleştirme etiketi Mailory karşılığına çevrildi|görsel Mailory'ye yüklendi|Outlook'a özel koşullu yorumlar/;
