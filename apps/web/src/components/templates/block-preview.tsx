import {
  EMAIL_FONTS,
  SOCIAL_LABELS,
  CONTACT_MERGE_FIELDS,
  SYSTEM_MERGE_FIELDS,
  applyMerge,
  escapeHtml,
  inlineToHtml,
  type Block,
  type EmailSettings,
  type LeafBlock,
  type MergeValues,
} from "@mailory/core/shared";

const SAMPLE: MergeValues = Object.fromEntries(
  [...CONTACT_MERGE_FIELDS, ...SYSTEM_MERGE_FIELDS].map((f) => [f.key, f.sample]),
);

/** Canvas rendering of rich text: same escape-first pipeline as the real email, with sample personalization. */
const richHtml = (text: string, linkColor: string) =>
  applyMerge(inlineToHtml(text, linkColor), SAMPLE, escapeHtml);
const rich = (text: string, linkColor: string) => ({
  __html: richHtml(text, linkColor),
});

function Leaf({
  block,
  s,
  logoUrl,
}: {
  block: LeafBlock;
  s: EmailSettings;
  logoUrl: string;
}) {
  const font = EMAIL_FONTS[s.font].stack;
  const base = { fontFamily: font, color: s.textColor } as const;
  const align = "align" in block ? block.align : "left";

  switch (block.type) {
    case "heading":
      return (
        <div
          style={{
            ...base,
            color: s.headingColor,
            fontWeight: 700,
            fontSize: { 1: 28, 2: 22, 3: 18 }[block.level],
            lineHeight: 1.25,
            textAlign: align,
          }}
          dangerouslySetInnerHTML={rich(block.text, s.linkColor)}
        />
      );
    case "paragraph":
      return (
        <div
          style={{ ...base, fontSize: 16, lineHeight: 1.6, textAlign: align }}
          dangerouslySetInnerHTML={rich(block.text, s.linkColor)}
        />
      );
    case "image":
    case "video": {
      const src = block.type === "image" ? block.src : block.thumbnailSrc;
      return src ? (
        <img
          src={src}
          alt={block.alt}
          style={{
            display: "block",
            maxWidth: "100%",
            margin:
              align === "center" || block.type === "video"
                ? "0 auto"
                : align === "right"
                  ? "0 0 0 auto"
                  : 0,
            width: block.type === "image" ? `${block.widthPercent}%` : "100%",
          }}
        />
      ) : (
        <div className="flex h-24 items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
          Görsel seçilmedi
        </div>
      );
    }
    case "button":
      return (
        <div style={{ textAlign: align }}>
          <span
            style={{
              display: "inline-block",
              padding: "12px 28px",
              fontFamily: font,
              fontWeight: 700,
              borderRadius: s.radius,
              border: `2px solid ${s.buttonColor}`,
              background: block.variant === "solid" ? s.buttonColor : "transparent",
              color: block.variant === "solid" ? s.buttonTextColor : s.buttonColor,
            }}
            dangerouslySetInnerHTML={{ __html: richHtml(block.label, "inherit") }}
          />
        </div>
      );
    case "divider":
      return <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: 0 }} />;
    case "spacer":
      return (
        <div
          style={{ height: block.height }}
          className="flex items-center justify-center text-[10px] text-muted-foreground/60"
        >
          {block.height}px
        </div>
      );
    case "social":
      return (
        <div style={{ ...base, fontSize: 14, textAlign: align }}>
          {block.links.map((l) => SOCIAL_LABELS[l.network]).join("  ·  ") ||
            "Bağlantı yok"}
        </div>
      );
    case "quote":
      return (
        <blockquote
          style={{
            ...base,
            margin: 0,
            padding: "8px 0 8px 16px",
            borderLeft: `4px solid ${s.linkColor}`,
            fontSize: 18,
            fontStyle: "italic",
            lineHeight: 1.5,
          }}
        >
          <span dangerouslySetInnerHTML={rich(block.text, s.linkColor)} />
          {block.author ? (
            <div
              style={{
                fontSize: 14,
                fontStyle: "normal",
                color: "#6b7280",
                marginTop: 8,
              }}
            >
              — {block.author}
            </div>
          ) : null}
        </blockquote>
      );
    case "logo": {
      const src = block.src || logoUrl;
      return src ? (
        <img
          src={src}
          alt={block.alt}
          style={{
            display: "block",
            width: block.widthPx,
            maxWidth: "100%",
            margin:
              block.align === "center"
                ? "0 auto"
                : block.align === "right"
                  ? "0 0 0 auto"
                  : 0,
          }}
        />
      ) : (
        <div className="flex h-12 w-40 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
          Logo yok (Marka Kiti&apos;nden ekleyin)
        </div>
      );
    }
    case "html":
      // Never rendered live on the canvas: the real output is sanitized server-side (see Önizleme).
      return (
        <div className="rounded border border-dashed p-3 font-mono text-xs text-muted-foreground">
          HTML bloğu · {block.html.length} karakter
          <br />
          Güvenli çıktı için Önizleme sekmesine bakın.
        </div>
      );
    case "footer":
      return (
        <div
          style={{
            ...base,
            fontSize: 12,
            color: "#6b7280",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          <span dangerouslySetInnerHTML={rich(block.text, s.linkColor)} />
          {block.showUnsubscribe ? (
            <>
              <br />
              <u>Abonelikten çık</u>
            </>
          ) : null}
        </div>
      );
  }
}

export function BlockPreview({
  block,
  settings,
  logoUrl,
  selectedId,
  onSelect,
}: {
  block: Block;
  settings: EmailSettings;
  logoUrl: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (block.type !== "columns")
    return <Leaf block={block} s={settings} logoUrl={logoUrl} />;
  return (
    <div className="flex gap-3">
      {block.columns.map((col, i) => (
        <div
          key={i}
          className="min-w-0 flex-1 space-y-2 rounded border border-dashed border-border/70 p-2"
        >
          {col.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground">Boş sütun</p>
          ) : null}
          {col.map((child) => (
            <div
              key={child.id}
              role="button"
              tabIndex={0}
              aria-label={`Sütun içeriği: ${child.type}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(child.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(child.id);
                }
              }}
              className={
                child.id === selectedId
                  ? "rounded outline outline-2 outline-primary"
                  : "rounded hover:outline hover:outline-1 hover:outline-border"
              }
            >
              <Leaf block={child} s={settings} logoUrl={logoUrl} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
