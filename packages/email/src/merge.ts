import { applyMerge, type MergeValues } from "@mailory/core/shared";

export { applyMerge, type MergeValues };

/** Builds the lookup an email is rendered with for one contact (+ system values). */
export function buildMergeValues(
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    company?: string | null;
    position?: string | null;
    city?: string | null;
    sector?: string | null;
    custom?: Record<string, string | number | boolean | null>;
  },
  system: {
    unsubscribeUrl: string;
    viewInBrowserUrl: string;
    orgName: string;
    year?: number;
  },
): MergeValues {
  const values: MergeValues = {
    first_name: contact.firstName,
    last_name: contact.lastName,
    full_name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    email: contact.email,
    company: contact.company,
    position: contact.position,
    city: contact.city,
    sector: contact.sector,
    unsubscribe_url: system.unsubscribeUrl,
    view_in_browser_url: system.viewInBrowserUrl,
    org_name: system.orgName,
    current_year: system.year ?? new Date().getFullYear(),
  };
  for (const [key, value] of Object.entries(contact.custom ?? {}))
    values[`custom.${key}`] = value;
  return values;
}
