const ALIASES: Record<string, string[]> = {
  email: [
    "email",
    "eposta",
    "epostaadresi",
    "mail",
    "emailaddress",
    "mailadresi",
    "emailadresi",
    "epostaadres",
    "primaryemail",
  ],
  first_name: ["firstname", "ad", "adi", "isim", "name", "givenname", "ilkad"],
  last_name: ["lastname", "soyad", "soyadi", "surname", "familyname"],
  company: [
    "company",
    "sirket",
    "firma",
    "kurum",
    "organization",
    "organizasyon",
    "companyname",
    "sirketadi",
    "firmaadi",
  ],
  position: ["position", "pozisyon", "title", "unvan", "gorev", "jobtitle"],
  website: ["website", "web", "site", "url", "websitesi", "webadresi"],
  phone: [
    "phone",
    "telefon",
    "tel",
    "gsm",
    "cep",
    "cepno",
    "telefonno",
    "mobile",
    "phonenumber",
  ],
  sector: ["sector", "sektor", "industry"],
  city: ["city", "sehir", "il", "town"],
  source: ["source", "kaynak"],
};

const TR_FOLD: Record<string, string> = {
  ı: "i",
  İ: "i",
  ş: "s",
  Ş: "s",
  ğ: "g",
  Ğ: "g",
  ü: "u",
  Ü: "u",
  ö: "o",
  Ö: "o",
  ç: "c",
  Ç: "c",
};

export function normalizeHeader(header: string): string {
  return header
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => TR_FOLD[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Best-effort header → target guess so most files import with one click. A target is suggested at most once. */
export function suggestMapping(
  headers: string[],
  customKeys: { key: string; label: string }[] = [],
): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    if (!norm) continue;
    let target = Object.entries(ALIASES).find(([, aliases]) =>
      aliases.includes(norm),
    )?.[0];
    if (!target) {
      const custom = customKeys.find(
        (c) => normalizeHeader(c.label) === norm || normalizeHeader(c.key) === norm,
      );
      if (custom) target = `custom:${custom.key}`;
    }
    if (target && !used.has(target)) {
      mapping[header] = target;
      used.add(target);
    }
  }
  return mapping;
}
