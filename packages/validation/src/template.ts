import { z } from "zod";
import {
  FONT_KEYS,
  LIMITS,
  SOCIAL_NETWORKS,
  isHexColor,
  isSafeUrl,
  type EmailDoc,
} from "@mailory/core";

const color = z
  .string()
  .refine(isHexColor, { message: "Renk #rgb veya #rrggbb biçiminde olmalı." });
const align = z.enum(["left", "center", "right"]);
const text = (max: number = LIMITS.maxTextLength) => z.string().max(max);
const id = z.string().min(1).max(40);

/** Empty is allowed (unset); anything else must be an allow-listed URL. */
const optionalUrl = (allowMailto = false) =>
  z
    .string()
    .max(2000)
    .refine((v) => v === "" || isSafeUrl(v, { allowMailto }), {
      message: "Geçersiz bağlantı. Yalnızca http(s), mailto ve tel kullanılabilir.",
    });
const requiredUrl = (allowMailto = false) =>
  z
    .string()
    .max(2000)
    .refine((v) => isSafeUrl(v, { allowMailto }), {
      message: "Geçerli bir bağlantı girin (https://…).",
    });
/** Image sources: our own asset path (/a/<uuid>) or an absolute http(s) URL; never data: or scripts. */
const imageSrc = z
  .string()
  .max(2000)
  .refine((v) => v === "" || /^\/a\/[0-9a-f-]{36}$/i.test(v) || isSafeUrl(v), {
    message: "Geçersiz görsel adresi.",
  });

const leaf = z.discriminatedUnion("type", [
  z.object({
    id,
    type: z.literal("heading"),
    text: text(300),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    align,
  }),
  z.object({ id, type: z.literal("paragraph"), text: text(), align }),
  z.object({
    id,
    type: z.literal("image"),
    src: imageSrc,
    alt: text(200),
    href: optionalUrl(),
    widthPercent: z.number().int().min(10).max(100),
    align,
  }),
  z.object({
    id,
    type: z.literal("button"),
    label: text(100),
    href: requiredUrl(true),
    variant: z.enum(["solid", "outline"]),
    align,
  }),
  z.object({ id, type: z.literal("divider") }),
  z.object({ id, type: z.literal("spacer"), height: z.number().int().min(4).max(120) }),
  z.object({
    id,
    type: z.literal("social"),
    links: z
      .array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: requiredUrl() }))
      .max(8),
    align,
  }),
  z.object({ id, type: z.literal("quote"), text: text(1000), author: text(100) }),
  z.object({
    id,
    type: z.literal("logo"),
    src: imageSrc,
    alt: text(200),
    widthPx: z.number().int().min(40).max(400),
    align,
  }),
  z.object({
    id,
    type: z.literal("video"),
    thumbnailSrc: imageSrc,
    href: requiredUrl(),
    alt: text(200),
  }),
  z.object({ id, type: z.literal("html"), html: text(LIMITS.maxHtmlLength) }),
  z.object({
    id,
    type: z.literal("footer"),
    text: text(1000),
    showUnsubscribe: z.boolean(),
  }),
]);

const block = z.union([
  leaf,
  z.object({
    id,
    type: z.literal("columns"),
    columns: z.array(z.array(leaf).max(LIMITS.maxColumnBlocks)).min(2).max(3),
  }),
]);

export const emailDocSchema = z
  .object({
    version: z.literal(1),
    settings: z.object({
      width: z.number().int().min(480).max(700),
      backgroundColor: color,
      contentBackground: color,
      textColor: color,
      headingColor: color,
      linkColor: color,
      buttonColor: color,
      buttonTextColor: color,
      radius: z.number().int().min(0).max(24),
      font: z.enum(FONT_KEYS as [string, ...string[]]),
      preheader: text(200),
    }),
    blocks: z.array(block).max(LIMITS.maxBlocks),
    raw: z
      .object({
        html: z.string().max(LIMITS.maxRawHtmlLength),
        css: z.string().max(LIMITS.maxRawCssLength),
      })
      .optional(),
  })
  .superRefine((doc, ctx) => {
    if (doc.raw && doc.blocks.length > 0)
      ctx.addIssue({ code: "custom", message: "HTML şablonunda blok olamaz." });
    const { raw, ...rest } = doc as { raw?: unknown };
    void raw;
    if (JSON.stringify(rest).length > LIMITS.maxDocBytes)
      ctx.addIssue({ code: "custom", message: "E-posta içeriği çok büyük." });
    const ids = new Set<string>();
    const dup = (b: { id: string }) => {
      if (ids.has(b.id))
        ctx.addIssue({ code: "custom", message: "Blok kimlikleri benzersiz olmalı." });
      ids.add(b.id);
    };
    for (const b of doc.blocks) {
      dup(b);
      if (b.type === "columns") for (const col of b.columns) col.forEach(dup);
    }
  }) as unknown as z.ZodType<EmailDoc>;

import { TEMPLATE_CATEGORIES } from "./labels";
export { TEMPLATE_CATEGORIES, CATEGORY_LABELS } from "./labels";

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "Şablon adı gerekli.").max(120),
  category: z.enum(TEMPLATE_CATEGORIES).default("other"),
  /** Either start from a library template, or from a blank/brand doc. */
  libraryKey: z.string().max(60).optional(),
});
export const saveTemplateSchema = z.object({
  name: z.string().trim().min(1, "Şablon adı gerekli.").max(120).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  doc: emailDocSchema,
  note: z.string().max(200).optional(),
  /** The version the editor loaded; a mismatch means someone else saved in between. */
  expectedVersion: z.number().int().min(1).optional(),
});
export const duplicateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Şablon adı gerekli.").max(120),
});
export const archiveTemplateSchema = z.object({ archived: z.boolean() });
export const previewTemplateSchema = z.object({ doc: emailDocSchema });
export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

// ---- brand kit -------------------------------------------------------------------------------------

export const brandKitSchema = z.object({
  logoAssetId: z.uuid().nullable(),
  primaryColor: color,
  textColor: color,
  backgroundColor: color,
  linkColor: color,
  buttonColor: color,
  buttonTextColor: color,
  font: z.enum(FONT_KEYS as [string, ...string[]]),
  buttonRadius: z.number().int().min(0).max(24),
  footerText: text(1000),
  socialLinks: z
    .array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: requiredUrl() }))
    .max(8),
});
export type BrandKitInput = z.infer<typeof brandKitSchema>;
