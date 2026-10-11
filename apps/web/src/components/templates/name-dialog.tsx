"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, Field, Input, NativeSelect } from "@mailory/ui";
import { CATEGORY_LABELS, TEMPLATE_CATEGORIES } from "@mailory/validation/labels";
import { FormError } from "../auth/auth-card";

/** Small "name it" dialog shared by create, duplicate and start-from-library. */
export function NameDialog({
  trigger,
  title,
  description,
  defaultName = "",
  submitLabel,
  withCategory = false,
  defaultCategory = "other",
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  defaultName?: string;
  submitLabel: string;
  withCategory?: boolean;
  defaultCategory?: string;
  /** Resolve to an error message to keep the dialog open, or null on success. */
  onSubmit: (input: { name: string; category: string }) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <DialogContent title={title} description={description}>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setPending(true);
            setError(null);
            const message = await onSubmit({
              name: String(data.get("name") ?? "").trim(),
              category: String(data.get("category") ?? defaultCategory),
            });
            setPending(false);
            if (message) setError(message);
            else setOpen(false);
          }}
        >
          <FormError message={error} />
          <Field id="nd-name" label="Şablon adı" required>
            <Input
              name="name"
              defaultValue={defaultName}
              required
              maxLength={120}
              autoFocus
            />
          </Field>
          {withCategory ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nd-cat" className="text-sm font-medium">
                Kategori
              </label>
              <NativeSelect id="nd-cat" name="category" defaultValue={defaultCategory}>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Vazgeç
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "İşleniyor…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
