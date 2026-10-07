"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  collectMergeKeys,
  createBlock,
  isKnownMergeKey,
  settingsFromBrand,
  walkBlocks,
  type Block,
  type BlockType,
  type BrandKit,
  type EmailDoc,
  type EmailSettings,
} from "@mailory/core/shared";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Input,
  NativeSelect,
} from "@mailory/ui";
import { CATEGORY_LABELS, TEMPLATE_CATEGORIES } from "@mailory/validation/labels";
import { FormError, Notice } from "../auth/auth-card";
import { apiCall } from "../audience/labels";
import { BlockPreview } from "./block-preview";
import {
  duplicateBlock,
  insertBlock,
  locate,
  moveBlock,
  removeBlock,
  reorder,
  updateBlock,
} from "./doc-utils";
import { Inspector } from "./inspector";

type Preview = { html: string; text: string; unknownKeys: string[] };
type VersionRow = {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  authorName: string | null;
};

const MAX_HISTORY = 60;

function SortableBlock({
  block,
  selected,
  onSelect,
  children,
  actions,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={`group relative ${selected ? "outline outline-2 outline-primary" : "hover:outline hover:outline-1 hover:outline-border"}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${BLOCK_LABELS[block.type]} bloğunu seç`}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            onSelect();
          }
        }}
        className="cursor-pointer px-6 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        {children}
      </div>
      <div
        className={`absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded border bg-surface px-1 py-0.5 shadow-sm ${selected ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`${BLOCK_LABELS[block.type]} bloğunu sürükle. Klavyeyle: Boşluk ile kaldır, ok tuşlarıyla taşı, Boşluk ile bırak.`}
          className="cursor-grab rounded p-1 text-muted-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        {actions}
      </div>
    </div>
  );
}

function PaletteItem({
  type,
  onAdd,
}: {
  type: BlockType;
  onAdd: (t: BlockType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
  });
  // Pointer drag only: Enter/Space must stay a plain click for keyboard users (they use the button to add).
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      onPointerDown={
        listeners?.onPointerDown as
          | React.PointerEventHandler<HTMLButtonElement>
          | undefined
      }
      onClick={() => onAdd(type)}
      aria-roledescription="sürüklenebilir blok"
      className={`flex w-full items-center gap-2 rounded border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isDragging ? "opacity-40" : ""}`}
    >
      <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />{" "}
      {BLOCK_LABELS[type]}
    </button>
  );
}

function CanvasEnd({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-end" });
  return (
    <div
      ref={setNodeRef}
      className={`mx-6 my-2 rounded border border-dashed px-3 py-3 text-center text-xs ${isOver ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"} ${active ? "" : "opacity-0"}`}
      aria-hidden={!active}
    >
      Buraya bırakın
    </div>
  );
}

export function TemplateEditor({
  templateId,
  initial,
  brand,
  logoUrl,
  customKeys,
  canWrite,
}: {
  templateId: string;
  initial: { name: string; category: string; version: number; doc: EmailDoc };
  brand: BrandKit;
  logoUrl: string;
  customKeys: string[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [doc, setDocState] = useState<EmailDoc>(initial.doc);
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState(initial.category);
  const [version, setVersion] = useState(initial.version);
  const [saved, setSaved] = useState(() =>
    JSON.stringify({ n: initial.name, c: initial.category, d: initial.doc }),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [draggingPalette, setDraggingPalette] = useState<BlockType | null>(null);
  const [past, setPast] = useState<EmailDoc[]>([]);
  const [future, setFuture] = useState<EmailDoc[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mobileWidth, setMobileWidth] = useState(false);
  const [showText, setShowText] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const lastTyping = useRef<{ key: string; at: number } | null>(null);

  const dirty = JSON.stringify({ n: name, c: category, d: doc }) !== saved;

  // ---- history ---------------------------------------------------------------------------------
  /** `typingKey` groups rapid edits of one field into one undo step. */
  const commit = useCallback(
    (next: EmailDoc | ((d: EmailDoc) => EmailDoc), typingKey?: string) => {
      setDocState((current) => {
        const value = typeof next === "function" ? next(current) : next;
        if (value === current) return current;
        const now = Date.now();
        const grouped =
          typingKey &&
          lastTyping.current?.key === typingKey &&
          now - lastTyping.current.at < 900;
        lastTyping.current = typingKey ? { key: typingKey, at: now } : null;
        if (!grouped) setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), current]);
        setFuture([]);
        return value;
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1]!;
      setDocState((current) => {
        setFuture((f) => [current, ...f]);
        return previous;
      });
      lastTyping.current = null;
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [next, ...rest] = f;
      setDocState((current) => {
        setPast((p) => [...p, current]);
        return next!;
      });
      lastTyping.current = null;
      return rest;
    });
  }, []);

  // ---- save ------------------------------------------------------------------------------------
  const save = useCallback(async () => {
    if (!canWrite || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const result = await apiCall(`/api/templates/${templateId}`, "PUT", {
      name,
      category,
      doc,
      expectedVersion: version,
    });
    setSaving(false);
    if (result.ok) {
      setVersion((result.data as { version: number }).version);
      setSaved(JSON.stringify({ n: name, c: category, d: doc }));
      setConflict(false);
      setNotice("Kaydedildi.");
      return;
    }
    setError(result.message);
    if (/başka biri/.test(result.message)) setConflict(true);
  }, [canWrite, saving, templateId, name, category, doc, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest(
        "input, textarea, select, [contenteditable]",
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if ((e.metaKey || e.ctrlKey) && !typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- preview (server-rendered: the exact HTML that would be sent) ---------------------------
  useEffect(() => {
    if (tab !== "preview") return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await apiCall("/api/templates/preview", "POST", { doc });
      if (cancelled) return;
      if (result.ok) {
        setPreview(result.data as Preview);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.message);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tab, doc]);

  // ---- editing helpers -------------------------------------------------------------------------
  const selected = selectedId ? (locate(doc, selectedId)?.block ?? null) : null;
  const insertAfterSelection = (type: BlockType) => {
    const block = createBlock(type);
    const top = selectedId ? locate(doc, selectedId)?.topIndex : undefined;
    commit((d) => insertBlock(d, block, top === undefined ? d.blocks.length : top + 1));
    setSelectedId(block.id);
  };
  const applyBrand = () =>
    commit((d) => ({
      ...d,
      settings: { ...d.settings, ...settingsFromBrand(brand) } as EmailSettings,
    }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(event: DragEndEvent) {
    setDraggingPalette(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    if (activeId.startsWith("palette:")) {
      const block = createBlock(activeId.slice(8) as BlockType);
      const overIndex =
        over.id === "canvas-end"
          ? doc.blocks.length - 1
          : doc.blocks.findIndex((b) => b.id === over.id);
      commit((d) => insertBlock(d, block, overIndex + 1));
      setSelectedId(block.id);
      return;
    }
    if (active.id !== over.id) commit((d) => reorder(d, activeId, String(over.id)));
  }

  // ---- local checks (cheap, no server) --------------------------------------------------------
  const warnings = useMemo(() => {
    const out: string[] = [];
    const unknown = collectMergeKeys(doc).filter(
      (k) => !isKnownMergeKey(k, customKeys),
    );
    if (unknown.length)
      out.push(
        `Bilinmeyen kişiselleştirme alanı: ${unknown.map((k) => `{{${k}}}`).join(", ")} (boş görünecek).`,
      );
    let hasUnsub = false;
    let missingAlt = 0;
    walkBlocks(doc, (b) => {
      if (b.type === "footer" && b.showUnsubscribe) hasUnsub = true;
      if (b.type === "image" && b.src && !b.alt.trim()) missingAlt++;
    });
    if (!hasUnsub)
      out.push(
        "“Abonelikten çık” bağlantılı bir alt bilgi bloğu yok; kampanya göndermeden önce eklenmelidir.",
      );
    if (missingAlt) out.push(`${missingAlt} görselde alternatif metin eksik.`);
    return out;
  }, [doc, customKeys]);

  async function openVersions() {
    setVersionsOpen(true);
    setVersions(null);
    const result = await apiCall(`/api/templates/${templateId}/versions`, "GET");
    if (result.ok) setVersions((result.data as { versions: VersionRow[] }).versions);
    else setError(result.message);
  }
  async function restore(versionId: string) {
    const result = await apiCall(
      `/api/templates/${templateId}/versions/${versionId}/restore`,
      "POST",
    );
    if (!result.ok) return setError(result.message);
    const fresh = await apiCall(`/api/templates/${templateId}`, "GET");
    if (!fresh.ok) return setError(fresh.message);
    const data = fresh.data as {
      version: number;
      doc: EmailDoc;
      template: { name: string; category: string };
    };
    setDocState(data.doc);
    setVersion(data.version);
    setSaved(
      JSON.stringify({ n: data.template.name, c: data.template.category, d: data.doc }),
    );
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setVersionsOpen(false);
    setNotice(`Sürüm geri yüklendi (yeni sürüm: ${data.version}).`);
    router.refresh();
  }

  const s = doc.settings;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="tpl-name" className="sr-only">
          Şablon adı
        </label>
        <Input
          id="tpl-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canWrite}
          maxLength={120}
          className="w-64 font-semibold"
        />
        <label htmlFor="tpl-cat" className="sr-only">
          Kategori
        </label>
        <NativeSelect
          id="tpl-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={!canWrite}
        >
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </NativeSelect>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "Kaydedilmemiş değişiklikler" : `Sürüm ${version} · kayıtlı`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Görünüm"
            className="flex rounded border p-0.5"
          >
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1 text-sm ${tab === t ? "bg-secondary font-medium" : "text-muted-foreground"}`}
              >
                {t === "edit" ? "Düzenle" : "Önizleme"}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Geri al"
            disabled={past.length === 0 || !canWrite}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Yinele"
            disabled={future.length === 0 || !canWrite}
            onClick={redo}
          >
            <Redo2 aria-hidden="true" />
          </Button>
          <Button variant="secondary" onClick={openVersions}>
            Sürümler
          </Button>
          {canWrite ? (
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          ) : null}
        </div>
      </div>

      <FormError message={error} />
      {conflict ? (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Sayfayı yenile ve son sürümü yükle
        </Button>
      ) : null}
      {notice && !error ? <Notice>{notice}</Notice> : null}
      {warnings.length ? (
        <ul
          aria-label="Uyarılar"
          className="flex flex-col gap-1 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-text"
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {tab === "preview" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              variant={mobileWidth ? "secondary" : "primary"}
              size="sm"
              onClick={() => setMobileWidth(false)}
            >
              Masaüstü
            </Button>
            <Button
              variant={mobileWidth ? "primary" : "secondary"}
              size="sm"
              onClick={() => setMobileWidth(true)}
            >
              Mobil
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowText((v) => !v)}>
              {showText ? "HTML sürümünü göster" : "Düz metin sürümünü göster"}
            </Button>
            {preview?.unknownKeys.length ? (
              <span className="text-warning-text">
                Bilinmeyen alanlar: {preview.unknownKeys.join(", ")}
              </span>
            ) : null}
          </div>
          {previewError ? (
            <p role="alert" className="text-sm text-danger">
              {previewError}
            </p>
          ) : null}
          {showText ? (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-surface p-4 text-sm">
              {preview?.text ?? "Hazırlanıyor…"}
            </pre>
          ) : (
            <div className="overflow-auto rounded-lg border bg-surface-muted p-4">
              <iframe
                title="E-posta önizlemesi"
                sandbox=""
                srcDoc={preview?.html ?? ""}
                style={{
                  width: mobileWidth ? 375 : Math.max(s.width + 48, 360),
                  maxWidth: "100%",
                  height: "70vh",
                  border: 0,
                  background: "#fff",
                  display: "block",
                  margin: "0 auto",
                }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Bu, gönderilecek e-postanın örnek bir kişiyle (Ayşe Yılmaz) üretilmiş
            halidir. HTML blokları güvenlik için temizlenmiştir.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => {
            const id = String(e.active.id);
            if (id.startsWith("palette:")) setDraggingPalette(id.slice(8) as BlockType);
          }}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingPalette(null)}
        >
          <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_320px]">
            {canWrite ? (
              <aside
                aria-label="Bloklar"
                className="flex flex-col gap-2 lg:sticky lg:top-4 lg:h-fit"
              >
                <h2 className="text-sm font-semibold">Bloklar</h2>
                <p className="text-xs text-muted-foreground">
                  Tıklayarak ekleyin veya tuvale sürükleyin.
                </p>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                  {BLOCK_TYPES.map((t) => (
                    <PaletteItem key={t} type={t} onAdd={insertAfterSelection} />
                  ))}
                </div>
              </aside>
            ) : (
              <div />
            )}

            <section
              aria-label="E-posta tuvali"
              className="min-w-0 rounded-lg border p-3 sm:p-6"
              style={{ background: s.backgroundColor }}
              onClick={() => setSelectedId(null)}
            >
              <div
                className="mx-auto"
                style={{
                  maxWidth: s.width,
                  background: s.contentBackground,
                  borderRadius: s.radius,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {doc.blocks.length === 0 ? (
                  <p className="px-6 py-16 text-center text-sm text-muted-foreground">
                    Henüz blok yok. Soldaki listeden bir blok ekleyin.
                  </p>
                ) : null}
                <SortableContext
                  items={doc.blocks.map((b) => b.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1 py-3">
                    {doc.blocks.map((block) => (
                      <SortableBlock
                        key={block.id}
                        block={block}
                        selected={block.id === selectedId}
                        onSelect={() => setSelectedId(block.id)}
                        actions={
                          canWrite ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label="Yukarı taşı"
                                onClick={() =>
                                  commit((d) => moveBlock(d, block.id, -1))
                                }
                              >
                                <ArrowUp aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label="Aşağı taşı"
                                onClick={() => commit((d) => moveBlock(d, block.id, 1))}
                              >
                                <ArrowDown aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label="Çoğalt"
                                onClick={() => {
                                  const r = duplicateBlock(doc, block.id);
                                  commit(r.doc);
                                  setSelectedId(r.newId);
                                }}
                              >
                                <Copy aria-hidden="true" />
                              </Button>
                              <ConfirmDialog
                                trigger={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label="Sil"
                                  >
                                    <Trash2 aria-hidden="true" />
                                  </Button>
                                }
                                title={`${BLOCK_LABELS[block.type]} bloğu silinsin mi?`}
                                description="Bu işlem “Geri al” ile geri alınabilir."
                                confirmLabel="Sil"
                                onConfirm={() => {
                                  commit((d) => removeBlock(d, block.id));
                                  if (selectedId === block.id) setSelectedId(null);
                                }}
                              />
                            </>
                          ) : null
                        }
                      >
                        <BlockPreview
                          block={block}
                          settings={s}
                          logoUrl={logoUrl}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                        />
                      </SortableBlock>
                    ))}
                  </div>
                </SortableContext>
                <CanvasEnd active={draggingPalette !== null} />
              </div>
            </section>

            <aside
              aria-label="Özellikler"
              className="rounded-lg border bg-surface p-4 lg:sticky lg:top-4 lg:h-fit lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
            >
              <Inspector
                doc={doc}
                block={selected}
                customKeys={customKeys}
                canWrite={canWrite}
                onChangeBlock={(patch) =>
                  selectedId &&
                  commit(
                    (d) =>
                      updateBlock(d, selectedId, (b) => ({ ...b, ...patch }) as Block),
                    `${selectedId}:${Object.keys(patch).join(",")}`,
                  )
                }
                onChangeDoc={(next) => commit(next)}
                onSelect={setSelectedId}
                onChangeSettings={(patch) =>
                  commit(
                    (d) => ({ ...d, settings: { ...d.settings, ...patch } }),
                    `settings:${Object.keys(patch).join(",")}`,
                  )
                }
                onApplyBrand={applyBrand}
              />
            </aside>
          </div>
          <DragOverlay>
            {draggingPalette ? (
              <div className="rounded border bg-surface px-3 py-2 text-sm shadow-lg">
                {BLOCK_LABELS[draggingPalette]}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent
          title="Sürüm geçmişi"
          description="Her kayıt yeni bir sürüm oluşturur. Geri yüklemek geçmişi silmez; eski içeriği yeni bir sürüm olarak ekler."
        >
          <div className="mt-4 max-h-80 overflow-y-auto">
            {versions === null ? (
              <p className="text-sm text-muted-foreground">Yükleniyor…</p>
            ) : (
              <ul className="divide-y">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        Sürüm {v.version}
                        {v.version === version ? " (güncel)" : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString("tr-TR")}
                        {v.authorName ? ` · ${v.authorName}` : ""}
                        {v.note ? ` · ${v.note}` : ""}
                      </div>
                    </div>
                    {canWrite && v.version !== version ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="secondary" size="sm">
                            Geri yükle
                          </Button>
                        }
                        title={`Sürüm ${v.version} geri yüklensin mi?`}
                        description={
                          dirty
                            ? "Kaydedilmemiş değişiklikleriniz kaybolur."
                            : "İçerik yeni bir sürüm olarak eklenir."
                        }
                        confirmLabel="Geri yükle"
                        onConfirm={() => restore(v.id)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { arrayMove };
