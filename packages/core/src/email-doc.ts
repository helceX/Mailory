/**
 * The email document model (docs/MAILORY_DECISIONS.md D-016): a JSON tree of blocks is the source of
 * truth; HTML and plain text are derived from it. Pure and browser-safe — the editor and the server
 * renderer share these types, merge-field rules and URL/colour guards.
 */

export const EMAIL_FONTS = {
  sans: { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  georgia: { label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  verdana: { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  trebuchet: { label: "Trebuchet MS", stack: '"Trebuchet MS", Helvetica, sans-serif' },
  tahoma: { label: "Tahoma", stack: "Tahoma, Geneva, sans-serif" },
  courier: { label: "Courier New", stack: '"Courier New", Courier, monospace' },
} as const;
export type FontKey = keyof typeof EMAIL_FONTS;
export const FONT_KEYS = Object.keys(EMAIL_FONTS) as FontKey[];

export const SOCIAL_NETWORKS = [
  "linkedin",
  "x",
  "instagram",
  "facebook",
  "youtube",
  "website",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  website: "Web sitesi",
};

export type Align = "left" | "center" | "right";

export type HeadingBlock = {
  id: string;
  type: "heading";
  text: string;
  level: 1 | 2 | 3;
  align: Align;
};
export type ParagraphBlock = {
  id: string;
  type: "paragraph";
  text: string;
  align: Align;
};
export type ImageBlock = {
  id: string;
  type: "image";
  src: string;
  alt: string;
  href: string;
  widthPercent: number;
  align: Align;
};
export type ButtonBlock = {
  id: string;
  type: "button";
  label: string;
  href: string;
  variant: "solid" | "outline";
  align: Align;
};
export type DividerBlock = { id: string; type: "divider" };
export type SpacerBlock = { id: string; type: "spacer"; height: number };
export type SocialBlock = {
  id: string;
  type: "social";
  links: { network: SocialNetwork; url: string }[];
  align: Align;
};
export type QuoteBlock = { id: string; type: "quote"; text: string; author: string };
export type LogoBlock = {
  id: string;
  type: "logo";
  src: string;
  alt: string;
  widthPx: number;
  align: Align;
};
export type VideoBlock = {
  id: string;
  type: "video";
  thumbnailSrc: string;
  href: string;
  alt: string;
};
export type HtmlBlock = { id: string; type: "html"; html: string };
export type FooterBlock = {
  id: string;
  type: "footer";
  text: string;
  showUnsubscribe: boolean;
};
/** Columns hold leaf blocks only: no nesting columns inside columns. */
export type LeafBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | SocialBlock
  | QuoteBlock
  | LogoBlock
  | VideoBlock
  | HtmlBlock
  | FooterBlock;
export type ColumnsBlock = { id: string; type: "columns"; columns: LeafBlock[][] };
export type Block = LeafBlock | ColumnsBlock;
export type BlockType = Block["type"];

export type EmailSettings = {
  width: number;
  backgroundColor: string;
  contentBackground: string;
  textColor: string;
  headingColor: string;
  linkColor: string;
  buttonColor: string;
  buttonTextColor: string;
  radius: number;
  font: FontKey;
  preheader: string;
};
export type EmailDoc = { version: 1; settings: EmailSettings; blocks: Block[] };

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Başlık",
  paragraph: "Paragraf",
  image: "Görsel",
  button: "Buton",
  divider: "Ayırıcı",
  spacer: "Boşluk",
  social: "Sosyal medya",
  columns: "Sütunlar",
  quote: "Alıntı",
  logo: "Logo",
  video: "Video küçük resmi",
  html: "HTML",
  footer: "Alt bilgi",
};
export const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as BlockType[];

export const DEFAULT_SETTINGS: EmailSettings = {
  width: 600,
  backgroundColor: "#f3f4f8",
  contentBackground: "#ffffff",
  textColor: "#2b2d38",
  headingColor: "#14151c",
  linkColor: "#4a3fd6",
  buttonColor: "#4a3fd6",
  buttonTextColor: "#ffffff",
  radius: 6,
  font: "sans",
  preheader: "",
};

export const LIMITS = {
  maxBlocks: 100,
  maxColumnBlocks: 20,
  maxDocBytes: 200_000,
  maxTextLength: 5000,
  maxHtmlLength: 20_000,
} as const;

let counter = 0;
/** Short unique-enough id for editor keys; not security-sensitive, and works without Node's crypto. */
export function newBlockId(): string {
  counter = (counter + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createBlock(type: BlockType): Block {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, text: "Başlığınızı yazın", level: 1, align: "left" };
    case "paragraph":
      return {
        id,
        type,
        text: "Merhaba {{first_name|değerli okuyucumuz}},\n\nMetninizi buraya yazın. **Kalın**, _italik_ ve [bağlantı](https://example.com) kullanabilirsiniz.",
        align: "left",
      };
    case "image":
      return {
        id,
        type,
        src: "",
        alt: "",
        href: "",
        widthPercent: 100,
        align: "center",
      };
    case "button":
      return {
        id,
        type,
        label: "Devamını oku",
        href: "https://example.com",
        variant: "solid",
        align: "left",
      };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, height: 24 };
    case "social":
      return {
        id,
        type,
        links: [{ network: "linkedin", url: "https://linkedin.com" }],
        align: "center",
      };
    case "columns":
      return {
        id,
        type,
        columns: [
          [{ ...(createBlock("paragraph") as ParagraphBlock), text: "Birinci sütun" }],
          [{ ...(createBlock("paragraph") as ParagraphBlock), text: "İkinci sütun" }],
        ],
      };
    case "quote":
      return { id, type, text: "Etkileyici bir alıntı.", author: "" };
    case "logo":
      return { id, type, src: "", alt: "Logo", widthPx: 140, align: "left" };
    case "video":
      return {
        id,
        type,
        thumbnailSrc: "",
        href: "https://example.com",
        alt: "Videoyu izle",
      };
    case "html":
      return { id, type, html: "<p>Özel HTML içeriği</p>" };
    case "footer":
      return { id, type, text: "Şirket Adı · Adres, Şehir", showUnsubscribe: true };
  }
}

export function createEmptyDoc(settings: Partial<EmailSettings> = {}): EmailDoc {
  return { version: 1, settings: { ...DEFAULT_SETTINGS, ...settings }, blocks: [] };
}

// ---- merge fields --------------------------------------------------------------------------------

export type MergeField = { key: string; label: string; sample: string };
export const CONTACT_MERGE_FIELDS: MergeField[] = [
  { key: "first_name", label: "Ad", sample: "Ayşe" },
  { key: "last_name", label: "Soyad", sample: "Yılmaz" },
  { key: "full_name", label: "Ad Soyad", sample: "Ayşe Yılmaz" },
  { key: "email", label: "E-posta", sample: "ayse@example.com" },
  { key: "company", label: "Şirket", sample: "Örnek A.Ş." },
  { key: "position", label: "Pozisyon", sample: "Kurucu" },
  { key: "city", label: "Şehir", sample: "Ankara" },
  { key: "sector", label: "Sektör", sample: "Teknoloji" },
];
export const SYSTEM_MERGE_FIELDS: MergeField[] = [
  {
    key: "unsubscribe_url",
    label: "Abonelikten çıkma bağlantısı",
    sample: "https://example.com/unsubscribe",
  },
  {
    key: "view_in_browser_url",
    label: "Tarayıcıda görüntüle bağlantısı",
    sample: "https://example.com/view",
  },
  { key: "org_name", label: "Organizasyon adı", sample: "Örnek Organizasyon" },
  { key: "current_year", label: "Yıl", sample: String(new Date().getFullYear()) },
];
export const SYSTEM_MERGE_KEYS = new Set(SYSTEM_MERGE_FIELDS.map((f) => f.key));

/** `{{ key }}` or `{{key|fallback}}`; keys are lowercase identifiers, `custom.<key>` for custom fields. */
export const MERGE_TOKEN =
  /\{\{\s*([a-z][a-z0-9_.]{0,48})\s*(?:\|([^{}]{0,100}))?\}\}/gi;

export function isKnownMergeKey(
  key: string,
  customKeys: readonly string[] = [],
): boolean {
  const k = key.toLowerCase();
  return (
    CONTACT_MERGE_FIELDS.some((f) => f.key === k) ||
    SYSTEM_MERGE_KEYS.has(k) ||
    (k.startsWith("custom.") && customKeys.includes(k.slice(7)))
  );
}

// ---- guards ---------------------------------------------------------------------------------------

export const isHexColor = (v: string) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

const WHOLE_SYSTEM_TOKEN = /^\{\{\s*(unsubscribe_url|view_in_browser_url)\s*\}\}$/i;

/**
 * Allow-list, not block-list: only http(s), mailto and tel — plus the two system link tokens used as
 * a whole value. `javascript:`, `data:`, `vbscript:` and protocol-relative tricks all fail closed.
 */
export function isSafeUrl(
  value: string,
  options: { allowMailto?: boolean } = {},
): boolean {
  const url = value.trim();
  if (!url || url.length > 2000) return false;
  if (WHOLE_SYSTEM_TOKEN.test(url)) return true;
  // A URL with merge tokens in the query is fine as long as it parses once tokens are replaced.
  const probe = url.replace(MERGE_TOKEN, "x");
  // Control characters and whitespace are how "java\nscript:" style obfuscation hides; reject them outright.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(probe)) return false;
  try {
    const parsed = new URL(probe);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return true;
    return (
      Boolean(options.allowMailto) &&
      (parsed.protocol === "mailto:" || parsed.protocol === "tel:")
    );
  } catch {
    return false;
  }
}

// ---- traversal ------------------------------------------------------------------------------------

export function walkBlocks(
  doc: EmailDoc,
  visit: (block: Block, parent: ColumnsBlock | null) => void,
) {
  for (const block of doc.blocks) {
    visit(block, null);
    if (block.type === "columns")
      for (const column of block.columns)
        for (const child of column) visit(child, block);
  }
}

/** Every user-authored string that may contain merge tokens. */
export function blockTexts(block: Block): string[] {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return [block.text];
    case "quote":
      return [block.text, block.author];
    case "button":
      return [block.label, block.href];
    case "image":
      return [block.alt, block.href];
    case "video":
      return [block.alt, block.href];
    case "logo":
      return [block.alt];
    case "footer":
      return [block.text];
    case "html":
      return [block.html];
    case "social":
      return block.links.map((l) => l.url);
    default:
      return [];
  }
}

export function collectMergeKeys(doc: EmailDoc): string[] {
  const keys = new Set<string>();
  const scan = (text: string) => {
    for (const m of text.matchAll(MERGE_TOKEN)) keys.add(m[1]!.toLowerCase());
  };
  scan(doc.settings.preheader);
  walkBlocks(doc, (block) => blockTexts(block).forEach(scan));
  return [...keys];
}
