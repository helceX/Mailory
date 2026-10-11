"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  EMAIL_FONTS,
  FONT_KEYS,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  createBlock,
  createEmptyDoc,
  settingsFromBrand,
  type BrandKit,
  type ButtonBlock,
  type FooterBlock,
  type HeadingBlock,
  type LogoBlock,
  type ParagraphBlock,
} from "@mailory/core/shared";
import { Button, Input, NativeSelect, Textarea } from "@mailory/ui";
import { FormError, Notice } from "../auth/auth-card";
import { apiCall } from "../audience/labels";
import { BlockPreview } from "./block-preview";

const COLORS: [keyof BrandKit, string][] = [
  ["primaryColor", "Ana renk"],
  ["buttonColor", "Buton rengi"],
  ["buttonTextColor", "Buton yazı rengi"],
  ["linkColor", "Bağlantı rengi"],
  ["textColor", "Metin rengi"],
  ["backgroundColor", "İçerik arka planı"],
];

export function BrandKitForm({
  initial,
  configured,
  canWrite,
}: {
  initial: BrandKit;
  configured: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandKit>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => {
    setBrand((b) => ({ ...b, [key]: value }));
    setSaved(false);
  };
  const logoUrl = brand.logoAssetId ? `/a/${brand.logoAssetId}` : "";

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/assets", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as {
        id?: string;
        error?: { message?: string };
      } | null;
      if (response.ok && data?.id) set("logoAssetId", data.id);
      else setError(data?.error?.message ?? "Logo yüklenemedi.");
    } catch {
      setError("Bağlantı hatası.");
    }
    setUploading(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await apiCall("/api/brand-kit", "PUT", brand);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setSaved(true);
    router.refresh();
  }

  // A miniature email in the current brand, built with the real settings + the same block renderer.
  const sample = createEmptyDoc(settingsFromBrand(brand));
  sample.blocks = [
    { ...(createBlock("logo") as LogoBlock), id: "p1" },
    {
      ...(createBlock("heading") as HeadingBlock),
      id: "p2",
      text: "Markanızla hazır başlık",
    },
    {
      ...(createBlock("paragraph") as ParagraphBlock),
      id: "p3",
      text: "Merhaba {{first_name|dostum}}, yeni e-postalarınız bu stille açılır.",
    },
    { ...(createBlock("button") as ButtonBlock), id: "p4", label: "Örnek buton" },
    {
      ...(createBlock("footer") as FooterBlock),
      id: "p5",
      text: brand.footerText || "Şirket adı · Adres",
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FormError message={error} />
        {saved ? (
          <Notice>Marka kiti kaydedildi. Yeni şablonlar bu stille başlar.</Notice>
        ) : null}
        {!configured && canWrite ? (
          <p className="rounded border bg-surface-muted p-3 text-sm text-muted-foreground">
            Henüz marka kitiniz yok. Bir kez tanımlayın; her yeni e-posta logonuz,
            renkleriniz ve alt bilginizle hazır başlasın.
          </p>
        ) : null}
        <fieldset disabled={!canWrite} className="flex flex-col gap-6">
          <section className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
            <h2 className="text-sm font-semibold">Logo</h2>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded border bg-surface-muted">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Mevcut logo"
                    className="max-h-14 max-w-36 object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">Logo yok</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center rounded border bg-secondary px-3 py-2 text-sm font-medium focus-within:ring-2 focus-within:ring-primary">
                  {uploading
                    ? "Yükleniyor…"
                    : logoUrl
                      ? "Logoyu değiştir"
                      : "Logo yükle"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="sr-only"
                    disabled={uploading || !canWrite}
                    onChange={(e) => {
                      void uploadLogo(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set("logoAssetId", null)}
                  >
                    Logoyu kaldır
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, GIF veya WebP · en fazla 1 MB. Şeffaf PNG önerilir.
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border bg-surface p-4 sm:grid-cols-2">
            <h2 className="text-sm font-semibold sm:col-span-2">Renkler ve yazı</h2>
            {COLORS.map(([key, text]) => (
              <div key={key} className="flex flex-col gap-1.5">
                {/* The label targets the text input itself (Field would put the id on the wrapper div). */}
                <label htmlFor={`bk-${key}`} className="text-sm font-medium">
                  {text}
                </label>
                <div className="flex gap-2">
                  <input
                    aria-label={`${text} seçici`}
                    type="color"
                    value={
                      /^#[0-9a-f]{6}$/i.test(String(brand[key]))
                        ? String(brand[key])
                        : "#000000"
                    }
                    onChange={(e) => set(key, e.target.value as never)}
                    className="h-9 w-12 cursor-pointer rounded border bg-surface p-1"
                  />
                  <Input
                    id={`bk-${key}`}
                    value={String(brand[key])}
                    onChange={(e) => set(key, e.target.value as never)}
                    maxLength={7}
                    className="font-mono"
                  />
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bk-font" className="text-sm font-medium">
                Yazı tipi
              </label>
              <NativeSelect
                id="bk-font"
                value={brand.font}
                onChange={(e) => set("font", e.target.value as BrandKit["font"])}
              >
                {FONT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {EMAIL_FONTS[k].label}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                E-posta istemcilerinde güvenle görüntülenen yazı tipleri.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bk-radius" className="text-sm font-medium">
                Buton köşe yuvarlaklığı: {brand.buttonRadius}px
              </label>
              <input
                id="bk-radius"
                type="range"
                min={0}
                max={24}
                value={brand.buttonRadius}
                onChange={(e) => set("buttonRadius", Number(e.target.value))}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
            <h2 className="text-sm font-semibold">Alt bilgi</h2>
            <label htmlFor="bk-footer" className="text-sm font-medium">
              Alt bilgi metni
            </label>
            <p id="bk-footer-hint" className="text-xs text-muted-foreground">
              Kuruluş adı ve posta adresi. Pazarlama e-postalarında yasal olarak
              bulunmalıdır.
            </p>
            <Textarea
              id="bk-footer"
              rows={3}
              value={brand.footerText}
              maxLength={1000}
              onChange={(e) => set("footerText", e.target.value)}
              placeholder={"Şirket A.Ş.\nMahalle, Cadde No:1, Şehir"}
            />
          </section>

          <section className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
            <h2 className="text-sm font-semibold">Sosyal medya bağlantıları</h2>
            {brand.socialLinks.map((l, i) => (
              <div key={i} className="flex gap-2">
                <NativeSelect
                  aria-label={`Bağlantı ${i + 1} ağı`}
                  value={l.network}
                  onChange={(e) =>
                    set(
                      "socialLinks",
                      brand.socialLinks.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              network: e.target
                                .value as BrandKit["socialLinks"][number]["network"],
                            }
                          : x,
                      ),
                    )
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
                  value={l.url}
                  onChange={(e) =>
                    set(
                      "socialLinks",
                      brand.socialLinks.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="https://"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Bağlantı ${i + 1} sil`}
                  onClick={() =>
                    set(
                      "socialLinks",
                      brand.socialLinks.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            {brand.socialLinks.length < 8 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() =>
                  set("socialLinks", [
                    ...brand.socialLinks,
                    { network: "linkedin", url: "https://" },
                  ])
                }
              >
                <Plus aria-hidden="true" /> Bağlantı ekle
              </Button>
            ) : null}
          </section>
        </fieldset>
        {canWrite ? (
          <div>
            <Button type="submit" disabled={saving || uploading}>
              {saving ? "Kaydediliyor…" : "Marka kitini kaydet"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Marka kitini yalnızca yöneticiler değiştirebilir.
          </p>
        )}
      </form>

      <aside
        aria-label="Önizleme"
        className="h-fit rounded-lg border p-4 lg:sticky lg:top-6"
        style={{ background: "#f3f4f8" }}
      >
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          Yeni bir e-posta böyle başlar
        </p>
        <div
          style={{
            background: sample.settings.contentBackground,
            borderRadius: sample.settings.radius,
          }}
          className="space-y-3 p-5"
        >
          {sample.blocks.map((b) => (
            <BlockPreview
              key={b.id}
              block={b}
              settings={sample.settings}
              logoUrl={logoUrl}
              selectedId={null}
              onSelect={() => {}}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}
