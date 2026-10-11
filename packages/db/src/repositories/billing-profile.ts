import { eq } from "drizzle-orm";
import { classifyTaxId } from "@mailory/core/shared";
import type { Database, OrganizationId } from "../index";
import { billingProfiles } from "../schema/index";

export type BillingProfileInput = {
  legalName: string;
  taxOffice: string;
  taxId: string;
  addressLine: string;
  district: string;
  city: string;
  postalCode: string;
  country: string;
  invoiceEmail: string;
};

export async function getBillingProfile(db: Database, organizationId: OrganizationId) {
  const [row] = await db
    .select()
    .from(billingProfiles)
    .where(eq(billingProfiles.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/** Creates or replaces the organization's single billing profile. Throws on an invalid tax number. */
export async function upsertBillingProfile(
  db: Database,
  organizationId: OrganizationId,
  input: BillingProfileInput,
) {
  const taxIdKind = classifyTaxId(input.taxId);
  if (!taxIdKind) throw new Error("Invalid tax number");
  const values = { ...input, taxIdKind };
  const [row] = await db
    .insert(billingProfiles)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: billingProfiles.organizationId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return row!;
}
