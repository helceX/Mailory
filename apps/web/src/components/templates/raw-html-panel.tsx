"use client";

import type { EmailDoc } from "@mailory/core/shared";
import { Field, Input } from "@mailory/ui";

const MONO = "font-mono text-xs leading-relaxed";

/**
 * Editing surface for an imported HTML template. The HTML is sanitized again on every render (preview and send), so
 * what you see in "Önizleme" is exactly what recipients get; unsupported tags and styles simply disappear there.
 */
export function RawHtmlPanel({
  doc,
  canWrite,
  onChange,
}: {
  doc: EmailDoc;
  canWrite: boolean;
  onChange: (next: (d: EmailDoc) => EmailDoc, typingKey: string) => void;
}) {
  const raw = doc.raw!;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-surface p-4 text-sm">
        <p className="font-medium">İçe aktarılmış HTML şablonu</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Bu şablon bloklarla değil HTML ile düzenlenir. Kişiselleştirme için{" "}
          <code>{"{{first_name}}"}</code>, <code>{"{{last_name}}"}</code>,{" "}
          <code>{"{{company}}"}</code> gibi alanları kullanın; abonelikten çık
          bağlantısı <code>{'href="{{unsubscribe_url}}"'}</code> ile zorunludur.
          Betikler, formlar ve güvensiz stiller otomatik temizlenir.
        </p>
      </div>
      <Field id="raw-preheader" label="Önizleme metni (preheader)">
        <Input
          value={doc.settings.preheader}
          maxLength={200}
          disabled={!canWrite}
          onChange={(e) =>
            onChange(
              (d) => ({ ...d, settings: { ...d.settings, preheader: e.target.value } }),
              "raw:preheader",
            )
          }
        />
      </Field>
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="raw-html">
        HTML (gövde)
        <textarea
          id="raw-html"
          className={`min-h-[360px] w-full rounded-md border bg-surface p-3 ${MONO}`}
          spellCheck={false}
          value={raw.html}
          readOnly={!canWrite}
          maxLength={300_000}
          onChange={(e) =>
            onChange(
              (d) => ({ ...d, raw: { ...d.raw!, html: e.target.value } }),
              "raw:html",
            )
          }
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="raw-css">
        CSS (&lt;style&gt;, mobil uyum için @media dahil)
        <textarea
          id="raw-css"
          className={`min-h-[160px] w-full rounded-md border bg-surface p-3 ${MONO}`}
          spellCheck={false}
          value={raw.css}
          readOnly={!canWrite}
          maxLength={60_000}
          onChange={(e) =>
            onChange(
              (d) => ({ ...d, raw: { ...d.raw!, css: e.target.value } }),
              "raw:css",
            )
          }
        />
      </label>
    </div>
  );
}
