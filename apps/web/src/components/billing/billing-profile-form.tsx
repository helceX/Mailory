"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

export type BillingProfileView = {
  legalName: string;
  taxOffice: string;
  taxId: string;
  addressLine: string;
  district: string;
  city: string;
  postalCode: string;
  invoiceEmail: string;
};

/** Legal invoice details. Saving does not start a subscription — it is the prerequisite for a paid plan. */
export function BillingProfileForm({
  profile,
}: {
  profile: BillingProfileView | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const get = (n: string) => String(f.get(n) ?? "");
    const r = await apiCall("/api/billing-profile", "PUT", {
      legalName: get("legalName"),
      taxOffice: get("taxOffice"),
      taxId: get("taxId"),
      addressLine: get("addressLine"),
      district: get("district"),
      city: get("city"),
      postalCode: get("postalCode"),
      invoiceEmail: get("invoiceEmail"),
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
      noValidate
    >
      <Field id="bp-legalName" label="Unvan (sicilde kayıtlı adıyla)" required>
        <Input
          name="legalName"
          defaultValue={profile?.legalName ?? ""}
          autoComplete="organization"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="bp-taxOffice" label="Vergi dairesi" required>
          <Input name="taxOffice" defaultValue={profile?.taxOffice ?? ""} />
        </Field>
        <Field
          id="bp-taxId"
          label="Vergi numarası (VKN / TCKN)"
          hint="Şirket için 10, şahıs için 11 hane."
          required
        >
          <Input name="taxId" inputMode="numeric" defaultValue={profile?.taxId ?? ""} />
        </Field>
      </div>
      <Field id="bp-addressLine" label="Adres" required>
        <Input
          name="addressLine"
          defaultValue={profile?.addressLine ?? ""}
          autoComplete="street-address"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="bp-district" label="İlçe">
          <Input name="district" defaultValue={profile?.district ?? ""} />
        </Field>
        <Field id="bp-city" label="İl" required>
          <Input
            name="city"
            defaultValue={profile?.city ?? ""}
            autoComplete="address-level2"
          />
        </Field>
        <Field id="bp-postalCode" label="Posta kodu">
          <Input
            name="postalCode"
            defaultValue={profile?.postalCode ?? ""}
            autoComplete="postal-code"
          />
        </Field>
      </div>
      <Field
        id="bp-invoiceEmail"
        label="Fatura e-postası"
        hint="Faturalar bu adrese gönderilir."
        required
      >
        <Input
          name="invoiceEmail"
          type="email"
          defaultValue={profile?.invoiceEmail ?? ""}
        />
      </Field>
      <FormError message={error} />
      {saved ? (
        <p role="status" className="text-sm">
          Fatura bilgileri kaydedildi.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Kaydediliyor…" : "Fatura bilgilerini kaydet"}
        </Button>
      </div>
    </form>
  );
}
