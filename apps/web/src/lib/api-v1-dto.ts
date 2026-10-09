/*
 * The PUBLIC shape of our resources. Routes never return database rows: this file is the versioned contract, so adding
 * a column internally can never leak it, and renaming one does not break integrators.
 */
type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

export function contactDto(c: Row) {
  return {
    id: c.id,
    email: c.email,
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
    company: c.company ?? null,
    position: c.position ?? null,
    website: c.website ?? null,
    phone: c.phone ?? null,
    sector: c.sector ?? null,
    city: c.city ?? null,
    status: c.status,
    source: c.source ?? null,
    consentStatus: c.consentStatus ?? null,
    custom: c.custom ?? {},
    tags: Array.isArray(c.tags)
      ? (c.tags as { name: string }[]).map((t) => t.name)
      : undefined,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

export function listDto(l: Row) {
  return {
    id: l.id,
    name: l.name,
    description: l.description ?? null,
    contactCount: l.contactCount ?? l.contact_count ?? 0,
    createdAt: iso(l.createdAt ?? l.created_at),
  };
}

export function campaignDto(c: Row) {
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    status: c.status,
    scheduledAt: iso(c.scheduledAt),
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
    createdAt: iso(c.createdAt),
  };
}
