import { promises as dnsPromises } from "node:dns";
import { readFileSync } from "node:fs";

/**
 * DNS access behind an interface so verification logic is testable without a network and so a transient lookup
 * failure (timeout, SERVFAIL) can never be mistaken for "the record is gone".
 */
export interface DnsResolver {
  /** Each TXT record, its chunks joined. Resolves to [] when the name/record does not exist; THROWS on lookup failure. */
  txt(name: string): Promise<string[]>;
  /** CNAME targets. Same contract as txt(). */
  cname(name: string): Promise<string[]>;
  /** MX exchange hostnames, best priority first. Same contract as txt(). */
  mx(name: string): Promise<string[]>;
}

export class DnsLookupError extends Error {
  constructor(name: string, cause: unknown) {
    super(`DNS lookup failed for ${name}: ${(cause as Error)?.message ?? cause}`);
    this.name = "DnsLookupError";
  }
}

const NOT_FOUND = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENOENT"]);

export class SystemDnsResolver implements DnsResolver {
  private readonly resolver: dnsPromises.Resolver;
  constructor(options: { timeoutMs?: number; tries?: number } = {}) {
    this.resolver = new dnsPromises.Resolver({
      timeout: options.timeoutMs ?? 3000,
      tries: options.tries ?? 2,
    });
  }
  private async lookup<T>(name: string, run: () => Promise<T[]>): Promise<T[]> {
    try {
      return await run();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (NOT_FOUND.has(code)) return [];
      throw new DnsLookupError(name, error);
    }
  }
  txt(name: string) {
    return this.lookup(name, async () =>
      (await this.resolver.resolveTxt(name)).map((chunks) => chunks.join("")),
    );
  }
  cname(name: string) {
    return this.lookup(name, () => this.resolver.resolveCname(name));
  }
  mx(name: string) {
    return this.lookup(name, async () =>
      (await this.resolver.resolveMx(name))
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange),
    );
  }
}

export type MockZone = Record<
  string,
  { TXT?: string[]; CNAME?: string[]; MX?: string[]; FAIL?: boolean }
>;

/**
 * Test/dev resolver. Records live in an in-memory zone or a JSON file re-read on every lookup, so an
 * end-to-end test can "publish DNS" while the server runs. Entries with `FAIL: true` simulate a lookup error.
 * The config layer refuses to enable this in production.
 */
export class MockDnsResolver implements DnsResolver {
  private readonly file: string | null;
  private readonly memory: MockZone;
  /** Pass a zone object, or `{ file }` to re-read a JSON zone file on every lookup. */
  constructor(source: MockZone | { file: string }, options: { isFile?: boolean } = {}) {
    const asFile =
      options.isFile ?? typeof (source as { file?: unknown }).file === "string";
    this.file = asFile ? (source as { file: string }).file : null;
    this.memory = asFile ? {} : (source as MockZone);
  }
  private zone(): MockZone {
    if (!this.file) return this.memory;
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as MockZone;
    } catch {
      return {};
    }
  }
  private entry(name: string) {
    return this.zone()[name.toLowerCase()];
  }
  async txt(name: string) {
    const e = this.entry(name);
    if (e?.FAIL) throw new DnsLookupError(name, new Error("simulated failure"));
    return e?.TXT ?? [];
  }
  async cname(name: string) {
    const e = this.entry(name);
    if (e?.FAIL) throw new DnsLookupError(name, new Error("simulated failure"));
    return e?.CNAME ?? [];
  }
  async mx(name: string) {
    const e = this.entry(name);
    if (e?.FAIL) throw new DnsLookupError(name, new Error("simulated failure"));
    return e?.MX ?? [];
  }
}

// ---- the records an organization must publish ------------------------------------------------------

export type DnsRecordKey = "ownership" | "dkim1" | "dkim2" | "dkim3" | "spf" | "dmarc";
export type DnsRecord = {
  key: DnsRecordKey;
  required: boolean;
  type: "TXT" | "CNAME";
  /** Fully qualified name. */
  host: string;
  /** The same name relative to the domain, for DNS panels that append the domain automatically. */
  hostShort: string;
  value: string;
  title: string;
  explain: string;
};

export const OWNERSHIP_PREFIX = "mailory-verification=";
export const DKIM_TARGET_SUFFIX = ".dkim.amazonses.com";
export const SPF_INCLUDE = "include:amazonses.com";

export function buildDnsRecords(input: {
  domain: string;
  dkimTokens: string[];
  ownershipToken: string;
}): DnsRecord[] {
  const { domain } = input;
  const records: DnsRecord[] = [
    {
      key: "ownership",
      required: true,
      type: "TXT",
      host: `_mailory-verification.${domain}`,
      hostShort: "_mailory-verification",
      value: `${OWNERSHIP_PREFIX}${input.ownershipToken}`,
      title: "Alan adı sahipliği",
      explain:
        "Bu alan adının size ait olduğunu kanıtlar. Yalnızca alan adının DNS ayarlarına erişimi olan kişi ekleyebilir.",
    },
  ];
  input.dkimTokens.forEach((token, i) => {
    records.push({
      key: `dkim${i + 1}` as DnsRecordKey,
      required: true,
      type: "CNAME",
      host: `${token}._domainkey.${domain}`,
      hostShort: `${token}._domainkey`,
      value: `${token}${DKIM_TARGET_SUFFIX}`,
      title: `DKIM imzası (${i + 1}/3)`,
      explain:
        "E-postalarınıza dijital imza ekler; alıcı sunucuların mesajın sizden geldiğini ve yolda değişmediğini doğrulamasını sağlar.",
    });
  });
  records.push(
    {
      key: "spf",
      required: false,
      type: "TXT",
      host: domain,
      hostShort: "@",
      value: `v=spf1 ${SPF_INCLUDE} ~all`,
      title: "SPF (önerilen)",
      explain:
        "Hangi sunucuların adınıza e-posta gönderebileceğini belirtir. Alan adınızda zaten bir SPF kaydı varsa YENİ kayıt eklemeyin; mevcut kayda include:amazonses.com ifadesini ekleyin.",
    },
    {
      key: "dmarc",
      required: false,
      type: "TXT",
      host: `_dmarc.${domain}`,
      hostShort: "_dmarc",
      value: "v=DMARC1; p=none;",
      title: "DMARC (önerilen)",
      explain:
        "Kimlik doğrulaması başarısız mesajlara alıcıların ne yapacağını söyler. “p=none” yalnızca izleme modudur; sonuçları birkaç hafta izledikten sonra “quarantine” veya “reject”e geçmeniz önerilir.",
    },
  );
  return records;
}

// ---- checking ---------------------------------------------------------------------------------------

export type RecordState = "ok" | "missing" | "mismatch" | "warning" | "error";
export type RecordResult = {
  key: DnsRecordKey;
  required: boolean;
  state: RecordState;
  found: string[];
  message: string;
};

const unquote = (v: string) => v.trim().replace(/^"|"$/g, "").trim();
const normalizeHost = (v: string) => v.trim().toLowerCase().replace(/\.$/, "");
const safe = async <T>(
  run: () => Promise<T[]>,
): Promise<{ values: T[] } | { error: true }> => {
  try {
    return { values: await run() };
  } catch {
    return { error: true };
  }
};

export async function checkDns(
  resolver: DnsResolver,
  records: DnsRecord[],
): Promise<RecordResult[]> {
  return Promise.all(
    records.map(async (rec): Promise<RecordResult> => {
      const base = { key: rec.key, required: rec.required };
      if (rec.type === "CNAME") {
        const r = await safe(() => resolver.cname(rec.host));
        if ("error" in r)
          return {
            ...base,
            state: "error",
            found: [],
            message: "DNS sorgusu şu an yanıt vermedi; biraz sonra tekrar denenecek.",
          };
        const found = r.values.map(normalizeHost);
        if (found.includes(normalizeHost(rec.value)))
          return { ...base, state: "ok", found, message: "Kayıt bulundu." };
        return found.length
          ? {
              ...base,
              state: "mismatch",
              found,
              message:
                "Kayıt var ama değeri beklenenden farklı. Değeri aşağıdakiyle birebir aynı olacak şekilde düzeltin.",
            }
          : {
              ...base,
              state: "missing",
              found,
              message:
                "Kayıt henüz bulunamadı. DNS değişikliklerinin yayılması birkaç dakikadan birkaç saate kadar sürebilir.",
            };
      }

      const r = await safe(() => resolver.txt(rec.host));
      if ("error" in r)
        return {
          ...base,
          state: "error",
          found: [],
          message: "DNS sorgusu şu an yanıt vermedi; biraz sonra tekrar denenecek.",
        };
      const txt = r.values.map(unquote);

      if (rec.key === "ownership") {
        if (txt.includes(rec.value))
          return { ...base, state: "ok", found: txt, message: "Sahiplik doğrulandı." };
        const other = txt.filter((t) => t.startsWith(OWNERSHIP_PREFIX));
        return other.length
          ? {
              ...base,
              state: "mismatch",
              found: other,
              message:
                "Bu ad altında farklı bir doğrulama değeri var. Değeri aşağıdakiyle değiştirin.",
            }
          : {
              ...base,
              state: "missing",
              found: [],
              message: "Kayıt henüz bulunamadı.",
            };
      }

      if (rec.key === "spf") {
        const spf = txt.filter((t) => /^v=spf1(\s|$)/i.test(t));
        if (spf.length === 0)
          return {
            ...base,
            state: "missing",
            found: [],
            message: "SPF kaydı yok. Önerilen kaydı ekleyin.",
          };
        if (spf.length > 1)
          return {
            ...base,
            state: "mismatch",
            found: spf,
            message:
              "Birden fazla SPF kaydı var; bu, SPF'in tamamen geçersiz sayılmasına yol açar. Tek bir kayıtta birleştirin.",
          };
        if (spf[0]!.toLowerCase().includes(SPF_INCLUDE))
          return {
            ...base,
            state: "ok",
            found: spf,
            message: "SPF kaydı Amazon SES'i içeriyor.",
          };
        return {
          ...base,
          state: "warning",
          found: spf,
          message: `Mevcut SPF kaydınıza “${SPF_INCLUDE}” ifadesini ekleyin (örn. “v=spf1 … ${SPF_INCLUDE} ~all”). Yeni ikinci bir kayıt eklemeyin.`,
        };
      }

      // dmarc
      const dmarc = txt.filter((t) => /^v=dmarc1(\s|;|$)/i.test(t));
      if (dmarc.length === 0)
        return {
          ...base,
          state: "missing",
          found: [],
          message: "DMARC kaydı yok. Önerilen kaydı ekleyin.",
        };
      const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i
        .exec(dmarc[0]!)?.[1]
        ?.toLowerCase();
      if (policy === "quarantine" || policy === "reject")
        return {
          ...base,
          state: "ok",
          found: dmarc,
          message: `DMARC politikası: ${policy}.`,
        };
      if (policy === "none")
        return {
          ...base,
          state: "warning",
          found: dmarc,
          message:
            "DMARC “p=none” (yalnızca izleme). Raporları inceledikten sonra “quarantine”e geçmeniz önerilir.",
        };
      return {
        ...base,
        state: "mismatch",
        found: dmarc,
        message: "DMARC kaydında geçerli bir “p=” politikası bulunamadı.",
      };
    }),
  );
}
