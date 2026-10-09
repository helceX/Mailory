"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BLOCK_LABELS,
  CONTACT_MERGE_FIELDS,
  EMAIL_FONTS,
  FONT_KEYS,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  SYSTEM_MERGE_FIELDS,
  createBlock,
  type Align,
  type Block,
  type BlockType,
  type EmailSettings,
  type LeafBlock,
} from "@mailory/core/shared";
import { Button, Input, NativeSelect, Textarea } from "@mailory/ui";
import { apiCall } from "../audience/labels";
import { addToColumn, moveBlock, removeBlock, setColumnCount } from "./doc-utils";
import type { EmailDoc } from "@mailory/core/shared";

const LEAF_TYPES = (Object.keys(BLOCK_LABELS) as BlockType[]).filter(
  (t) => t !== "columns",
);

function Row({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function AlignSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Align;
  onChange: (v: Align) => void;
}) {
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Align)}
      className="w-full"
    >
      <option value="left">Sola</option>
      <option value="center">Ortaya</option>
      <option value="right">Sağa</option>
    </NativeSelect>
  );
}

/** Insert a merge token at the caret of the text control it is attached to. */
function MergePicker({
  customKeys,
  onPick,
}: {
  customKeys: string[];
  onPick: (token: string) => void;
}) {
  return (
    <NativeSelect
      aria-label="Kişiselleştirme alanı ekle"
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="w-full"
    >
      <option value="">Kişiselleştirme alanı ekle…</option>
      <optgroup label="Kişi">
        {CONTACT_MERGE_FIELDS.map((f) => (
          <option key={f.key} value={`{{${f.key}}}`}>
            {f.label}
          </option>
        ))}
      </optgroup>
      {customKeys.length ? (
        <optgroup label="Özel alanlar">
          {customKeys.map((k) => (
            <option key={k} value={`{{custom.${k}}}`}>
              {k}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Sistem">
        {SYSTEM_MERGE_FIELDS.map((f) => (
          <option key={f.key} value={`{{${f.key}}}`}>
            {f.label}
          </option>
        ))}
      </optgroup>
    </NativeSelect>
  );
}

function RichText({
  id,
  value,
  onChange,
  customKeys,
  rows = 5,
  mono = false,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  customKeys: string[];
  rows?: number;
  mono?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono text-xs" : undefined}
      />
      <MergePicker customKeys={customKeys} onPick={insert} />
    </div>
  );
}

/** Upload an image (or paste a URL). Returns the public path `/a/<id>` on success. */
function ImageField({
  id,
  value,
  onChange,
  canUpload,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  canUpload: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/assets", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        error?: { message?: string };
      } | null;
      if (response.ok && data?.url) onChange(data.url);
      else setError(data?.error?.message ?? "Yükleme başarısız.");
    } catch {
      setError("Bağlantı hatası.");
    }
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2">
      {canUpload ? (
        <label className="flex cursor-pointer items-center justify-center rounded border border-dashed px-3 py-3 text-sm hover:bg-surface-muted focus-within:ring-2 focus-within:ring-primary">
          {busy ? "Yükleniyor…" : "Görsel yükle (PNG, JPEG, GIF, WebP · en fazla 1 MB)"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="veya görsel adresi (https://…)"
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Inspector({
  doc,
  block,
  customKeys,
  canWrite,
  onChangeBlock,
  onChangeDoc,
  onSelect,
  onChangeSettings,
  onApplyBrand,
}: {
  doc: EmailDoc;
  block: Block | null;
  customKeys: string[];
  canWrite: boolean;
  onChangeBlock: (patch: Partial<Block>) => void;
  onChangeDoc: (next: EmailDoc) => void;
  onSelect: (id: string | null) => void;
  onChangeSettings: (patch: Partial<EmailSettings>) => void;
  onApplyBrand: () => void;
}) {
  if (!block)
    return (
      <SettingsPanel
        settings={doc.settings}
        canWrite={canWrite}
        onChange={onChangeSettings}
        onApplyBrand={onApplyBrand}
        customKeys={customKeys}
      />
    );

  const set = (patch: Record<string, unknown>) =>
    onChangeBlock(patch as Partial<Block>);
  const b = block as Block & Record<string, unknown>;
  const str = (k: string) => String(b[k] ?? "");

  return (
    <fieldset disabled={!canWrite} className="flex flex-col gap-4">
      <legend className="mb-1 flex w-full items-center justify-between text-sm font-semibold">
        {BLOCK_LABELS[block.type]}
        <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>
          E-posta ayarları
        </Button>
      </legend>

      {block.type === "heading" && (
        <>
          <Row label="Metin" htmlFor="i-text">
            <RichText
              id="i-text"
              value={str("text")}
              onChange={(v) => set({ text: v })}
              customKeys={customKeys}
              rows={2}
            />
          </Row>
          <Row label="Düzey" htmlFor="i-level">
            <NativeSelect
              id="i-level"
              value={block.level}
              onChange={(e) => set({ level: Number(e.target.value) })}
              className="w-full"
            >
              <option value={1}>Büyük (H1)</option>
              <option value={2}>Orta (H2)</option>
              <option value={3}>Küçük (H3)</option>
            </NativeSelect>
          </Row>
          <Row label="Hizalama" htmlFor="i-align">
            <AlignSelect
              id="i-align"
              value={block.align}
              onChange={(v) => set({ align: v })}
            />
          </Row>
        </>
      )}
      {block.type === "paragraph" && (
        <>
          <Row
            label="Metin"
            htmlFor="i-text"
            hint="**kalın**, _italik_, [bağlantı](https://…) kullanabilirsiniz."
          >
            <RichText
              id="i-text"
              value={str("text")}
              onChange={(v) => set({ text: v })}
              customKeys={customKeys}
              rows={8}
            />
          </Row>
          <Row label="Hizalama" htmlFor="i-align">
            <AlignSelect
              id="i-align"
              value={block.align}
              onChange={(v) => set({ align: v })}
            />
          </Row>
        </>
      )}
      {block.type === "image" && (
        <>
          <Row label="Görsel" htmlFor="i-src">
            <ImageField
              id="i-src"
              value={block.src}
              onChange={(v) => set({ src: v })}
              canUpload={canWrite}
            />
          </Row>
          <Row
            label="Alternatif metin"
            htmlFor="i-alt"
            hint="Görseller kapalıyken ve ekran okuyucular için gösterilir."
          >
            <Input
              id="i-alt"
              value={block.alt}
              onChange={(e) => set({ alt: e.target.value })}
            />
          </Row>
          <Row label="Tıklanınca açılacak bağlantı (isteğe bağlı)" htmlFor="i-href">
            <Input
              id="i-href"
              value={block.href}
              onChange={(e) => set({ href: e.target.value })}
              placeholder="https://…"
            />
          </Row>
          <Row label={`Genişlik: %${block.widthPercent}`} htmlFor="i-width">
            <input
              id="i-width"
              type="range"
              min={10}
              max={100}
              step={5}
              value={block.widthPercent}
              onChange={(e) => set({ widthPercent: Number(e.target.value) })}
            />
          </Row>
          <Row label="Hizalama" htmlFor="i-align">
            <AlignSelect
              id="i-align"
              value={block.align}
              onChange={(v) => set({ align: v })}
            />
          </Row>
        </>
      )}
      {block.type === "button" && (
        <>
          <Row label="Buton metni" htmlFor="i-label">
            <Input
              id="i-label"
              value={block.label}
              onChange={(e) => set({ label: e.target.value })}
            />
          </Row>
          <Row label="Bağlantı" htmlFor="i-href">
            <Input
              id="i-href"
              value={block.href}
              onChange={(e) => set({ href: e.target.value })}
              placeholder="https://…"
            />
          </Row>
          <Row label="Stil" htmlFor="i-variant">
            <NativeSelect
              id="i-variant"
              value={block.variant}
              onChange={(e) => set({ variant: e.target.value })}
              className="w-full"
            >
              <option value="solid">Dolu</option>
              <option value="outline">Çerçeveli</option>
            </NativeSelect>
          </Row>
          <Row label="Hizalama" htmlFor="i-align">
            <AlignSelect
              id="i-align"
              value={block.align}
              onChange={(v) => set({ align: v })}
            />
          </Row>
        </>
      )}
      {block.type === "spacer" && (
        <Row label={`Yükseklik: ${block.height}px`} htmlFor="i-height">
          <input
            id="i-height"
            type="range"
            min={4}
            max={120}
            step={4}
            value={block.height}
            onChange={(e) => set({ height: Number(e.target.value) })}
          />
        </Row>
      )}
      {block.type === "divider" && (
        <p className="text-sm text-muted-foreground">Bu bloğun ayarı yok.</p>
      )}
      {block.type === "social" && (
        <>
          <div className="flex flex-col gap-2">
            {block.links.map((link, i) => (
              <div key={i} className="flex gap-2">
                <NativeSelect
                  aria-label={`Bağlantı ${i + 1} ağı`}
                  value={link.network}
                  onChange={(e) =>
                    set({
                      links: block.links.map((l, j) =>
                        j === i ? { ...l, network: e.target.value } : l,
                      ),
                    })
                  }
                >
                  {SOCIAL_NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {SOCIAL_LABELS[n]}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label={`Bağlantı ${i + 1} adresi`}
                  value={link.url}
                  onChange={(e) =>
                    set({
                      links: block.links.map((l, j) =>
                        j === i ? { ...l, url: e.target.value } : l,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Bağlantı ${i + 1} sil`}
                  onClick={() => set({ links: block.links.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          {block.links.length < 8 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                set({
                  links: [...block.links, { network: "website", url: "https://" }],
                })
              }
            >
              <Plus aria-hidden="true" /> Bağlantı ekle
            </Button>
          ) : null}
          <Row label="Hizalama" htmlFor="i-align">
            <AlignSelect
              id="i-align"
              value={block.align}
              onChange={(v) => set({ align: v })}
            />
          </Row>
        </>
      )}
      {block.type === "quote" && (
        <>
          <Row label="Alıntı" htmlFor="i-text">
            <RichText
              id="i-text"
              value={block.text}
              onChange={(v) => set({ text: v })}
              customKeys={customKeys}
              rows={4}
            />
          </Row>
          <Row label="Kaynak (isteğe bağlı)" htmlFor="i-author">
            <Input
              id="i-author"
              value={block.author}
              onChange={(e) => set({ author: e.target.value })}
            />
          </Row>
        </>
      )}
      {block.type === "logo" && (
        <>
          <Row
            label="Logo"
            htmlFor="i-src"
            hint="Boş bırakırsanız Marka Kiti'ndeki logo kullanılır."
          >
            <ImageField
              id="i-src"
              value={block.src}
              onChange={(v) => set({ src: v })}
              canUpload={canWrite}
            />
          </Row>
          <Row label="Alternatif metin" htmlFor="i-alt">
            <Input
              id="i-alt"
              value={block.alt}
              onChange={(e) => set({ alt: e.target.value })}
            />
          </Row>
          <Row label={`Genişlik: ${block.widthPx}px`} htmlFor="i-w">
            <input
              id="i-w"
              type="range"
              min={40}
              max={400}
              step={10}
              value={block.widthPx}
              onChange={(e) => set({ widthPx: Number(e.target.value) })}
            />
          </Row>
          <Row label="Hizalama" htmlFor="i-align">
            <AlignSelect
              id="i-align"
              value={block.align}
              onChange={(v) => set({ align: v })}
            />
          </Row>
        </>
      )}
      {block.type === "video" && (
        <>
          <Row label="Küçük resim" htmlFor="i-src">
            <ImageField
              id="i-src"
              value={block.thumbnailSrc}
              onChange={(v) => set({ thumbnailSrc: v })}
              canUpload={canWrite}
            />
          </Row>
          <Row label="Video bağlantısı" htmlFor="i-href">
            <Input
              id="i-href"
              value={block.href}
              onChange={(e) => set({ href: e.target.value })}
              placeholder="https://…"
            />
          </Row>
          <Row label="Açıklama" htmlFor="i-alt">
            <Input
              id="i-alt"
              value={block.alt}
              onChange={(e) => set({ alt: e.target.value })}
            />
          </Row>
        </>
      )}
      {block.type === "html" && (
        <Row
          label="HTML"
          htmlFor="i-html"
          hint="Güvenlik için betikler, olay işleyicileri ve güvenli olmayan bağlantılar otomatik temizlenir."
        >
          <RichText
            id="i-html"
            value={block.html}
            onChange={(v) => set({ html: v })}
            customKeys={customKeys}
            rows={10}
            mono
          />
        </Row>
      )}
      {block.type === "footer" && (
        <>
          <Row
            label="Alt bilgi metni"
            htmlFor="i-text"
            hint="Kuruluşunuzun adı ve posta adresi burada yer almalıdır."
          >
            <RichText
              id="i-text"
              value={block.text}
              onChange={(v) => set({ text: v })}
              customKeys={customKeys}
              rows={4}
            />
          </Row>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={block.showUnsubscribe}
              onChange={(e) => set({ showUnsubscribe: e.target.checked })}
            />
            <span>
              “Abonelikten çık” bağlantısını göster{" "}
              <span className="block text-xs text-muted-foreground">
                Pazarlama e-postalarında yasal olarak zorunludur; kapatmanız önerilmez.
              </span>
            </span>
          </label>
        </>
      )}
      {block.type === "columns" && (
        <>
          <Row label="Sütun sayısı" htmlFor="i-cols">
            <NativeSelect
              id="i-cols"
              value={block.columns.length}
              onChange={(e) =>
                onChangeDoc(
                  setColumnCount(doc, block.id, Number(e.target.value) as 2 | 3),
                )
              }
              className="w-full"
            >
              <option value={2}>2 sütun</option>
              <option value={3}>3 sütun</option>
            </NativeSelect>
          </Row>
          {block.columns.map((col, c) => (
            <div key={c} className="flex flex-col gap-2 rounded border p-2">
              <p className="text-xs font-semibold">Sütun {c + 1}</p>
              {col.map((child) => (
                <div key={child.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex-1 rounded px-2 py-1 text-left text-sm hover:bg-surface-muted"
                    onClick={() => onSelect(child.id)}
                  >
                    {BLOCK_LABELS[child.type]}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Yukarı taşı"
                    onClick={() => onChangeDoc(moveBlock(doc, child.id, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Aşağı taşı"
                    onClick={() => onChangeDoc(moveBlock(doc, child.id, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Sütun içeriğini sil"
                    onClick={() => onChangeDoc(removeBlock(doc, child.id))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <NativeSelect
                aria-label={`Sütun ${c + 1}'e blok ekle`}
                value=""
                onChange={(e) =>
                  e.target.value &&
                  onChangeDoc(
                    addToColumn(
                      doc,
                      block.id,
                      c,
                      createBlock(e.target.value as BlockType) as LeafBlock,
                    ),
                  )
                }
              >
                <option value="">+ Blok ekle…</option>
                {LEAF_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BLOCK_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
        </>
      )}
    </fieldset>
  );
}

function ColorRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label} htmlFor={id}>
      <div className="flex gap-2">
        <input
          aria-label={`${label} seçici`}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border bg-surface p-1"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          className="font-mono"
        />
      </div>
    </Row>
  );
}

function SettingsPanel({
  settings,
  canWrite,
  onChange,
  onApplyBrand,
  customKeys,
}: {
  settings: EmailSettings;
  canWrite: boolean;
  onChange: (p: Partial<EmailSettings>) => void;
  onApplyBrand: () => void;
  customKeys: string[];
}) {
  void customKeys;
  return (
    <fieldset disabled={!canWrite} className="flex flex-col gap-4">
      <legend className="mb-1 text-sm font-semibold">E-posta ayarları</legend>
      <Button type="button" variant="secondary" size="sm" onClick={onApplyBrand}>
        Marka stilini uygula
      </Button>
      <Row
        label="Önizleme metni (preheader)"
        htmlFor="s-pre"
        hint="Gelen kutusunda konunun yanında görünen kısa özet."
      >
        <Input
          id="s-pre"
          value={settings.preheader}
          maxLength={200}
          onChange={(e) => onChange({ preheader: e.target.value })}
        />
      </Row>
      <Row label={`Genişlik: ${settings.width}px`} htmlFor="s-width">
        <input
          id="s-width"
          type="range"
          min={480}
          max={700}
          step={10}
          value={settings.width}
          onChange={(e) => onChange({ width: Number(e.target.value) })}
        />
      </Row>
      <Row label="Yazı tipi" htmlFor="s-font">
        <NativeSelect
          id="s-font"
          value={settings.font}
          onChange={(e) => onChange({ font: e.target.value as EmailSettings["font"] })}
          className="w-full"
        >
          {FONT_KEYS.map((k) => (
            <option key={k} value={k}>
              {EMAIL_FONTS[k].label}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <ColorRow
        id="s-bg"
        label="Arka plan rengi"
        value={settings.backgroundColor}
        onChange={(v) => onChange({ backgroundColor: v })}
      />
      <ColorRow
        id="s-cbg"
        label="İçerik rengi"
        value={settings.contentBackground}
        onChange={(v) => onChange({ contentBackground: v })}
      />
      <ColorRow
        id="s-text"
        label="Metin rengi"
        value={settings.textColor}
        onChange={(v) => onChange({ textColor: v })}
      />
      <ColorRow
        id="s-head"
        label="Başlık rengi"
        value={settings.headingColor}
        onChange={(v) => onChange({ headingColor: v })}
      />
      <ColorRow
        id="s-link"
        label="Bağlantı rengi"
        value={settings.linkColor}
        onChange={(v) => onChange({ linkColor: v })}
      />
      <ColorRow
        id="s-btn"
        label="Buton rengi"
        value={settings.buttonColor}
        onChange={(v) => onChange({ buttonColor: v })}
      />
      <ColorRow
        id="s-btxt"
        label="Buton yazı rengi"
        value={settings.buttonTextColor}
        onChange={(v) => onChange({ buttonTextColor: v })}
      />
      <Row label={`Köşe yuvarlaklığı: ${settings.radius}px`} htmlFor="s-radius">
        <input
          id="s-radius"
          type="range"
          min={0}
          max={24}
          value={settings.radius}
          onChange={(e) => onChange({ radius: Number(e.target.value) })}
        />
      </Row>
    </fieldset>
  );
}

export { apiCall };
