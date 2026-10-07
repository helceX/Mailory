import { randomBytes } from "node:crypto";
import {
  domainOfEmail,
  findCoveringDomain,
  isFreeMailDomain,
  isPlatformDomain,
  normalizeDomain,
  type Permission,
} from "@mailory/core";
import {
  countSenderDomainClaims,
  createSenderDomain,
  createSenderIdentity,
  deleteSenderDomain,
  deleteSenderIdentity,
  getOnboardingFacts,
  getSenderDomain,
  getSenderIdentity,
  listSenderDomains,
  listSenderIdentities,
  recordAudit,
  setDefaultSenderIdentity,
  updateSenderIdentity,
  type Database,
  type SenderDomain,
} from "@mailory/db";
import { checkAndPersistDomain } from "@mailory/deliverability";
import { buildDnsRecords, type DnsResolver, type DomainProvider } from "@mailory/email";
import type { SenderIdentityInput } from "@mailory/validation";
import { authorize, type Actor } from "../org/service";

export type SenderDeps = {
  db: Database;
  resolver: DnsResolver;
  provider: DomainProvider;
  platformHost: string;
  now?: () => Date;
};
type Code =
  | "forbidden"
  | "not_found"
  | "duplicate"
  | "invalid"
  | "free_mail"
  | "platform_domain"
  | "provider_error";
export type Failure = { ok: false; code: Code; message?: string };
export type Ok<T = object> = { ok: true } & T;

const denied: Failure = { ok: false, code: "forbidden" };
const need = (actor: Actor, permission: Permission) => authorize(actor, permission);

function audit(
  deps: SenderDeps,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata,
  });
}
const actorInfo = (actor: Actor) => ({
  userId: actor.userId,
  ip: actor.ip,
  userAgent: actor.userAgent,
});
const checkDeps = (deps: SenderDeps) => ({
  db: deps.db,
  resolver: deps.resolver,
  provider: deps.provider,
  now: deps.now,
});

// ---- domains -------------------------------------------------------------------------------------

export async function listDomains(deps: SenderDeps, actor: Actor) {
  if (!need(actor, "campaigns:read")) return denied;
  return {
    ok: true as const,
    domains: await listSenderDomains(deps.db, actor.organizationId),
  };
}

export async function addDomain(
  deps: SenderDeps,
  actor: Actor,
  raw: string,
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "sender:manage")) return denied;
  const domain = normalizeDomain(raw);
  if (!domain)
    return {
      ok: false,
      code: "invalid",
      message: "Geçerli bir alan adı girin (örn. sirketiniz.com).",
    };
  if (isFreeMailDomain(domain)) {
    return {
      ok: false,
      code: "free_mail",
      message:
        "Gmail, Outlook, Yahoo gibi ücretsiz e-posta sağlayıcıları gönderici alan adı olarak kullanılamaz. Kendi alan adınızı kullanın.",
    };
  }
  if (isPlatformDomain(domain, deps.platformHost))
    return {
      ok: false,
      code: "platform_domain",
      message: "Bu alan adı Mailory'e aittir ve gönderici olarak eklenemez.",
    };

  let tokens: string[];
  try {
    tokens = (await deps.provider.createIdentity(domain)).dkimTokens;
  } catch (error) {
    console.error("[senders] provider createIdentity failed", error);
    return {
      ok: false,
      code: "provider_error",
      message: "Alan adı şu anda eklenemedi. Lütfen daha sonra tekrar deneyin.",
    };
  }
  const row = await createSenderDomain(deps.db, actor.organizationId, {
    domain,
    provider: deps.provider.name,
    dkimTokens: tokens,
    ownershipToken: randomBytes(16).toString("hex"),
    userId: actor.userId,
  });
  if (!row) return { ok: false, code: "duplicate", message: "Bu alan adı zaten ekli." };
  await audit(deps, actor, "sender_domain.added", "sender_domain", row.id, { domain });
  return { ok: true, id: row.id };
}

export async function getDomainDetail(deps: SenderDeps, actor: Actor, id: string) {
  if (!need(actor, "sender:manage")) return denied;
  const row = await getSenderDomain(deps.db, actor.organizationId, id);
  if (!row) return { ok: false, code: "not_found" } as Failure;
  return {
    ok: true as const,
    domain: row,
    records: buildDnsRecords({
      domain: row.domain,
      dkimTokens: row.dkimTokens,
      ownershipToken: row.ownershipToken,
    }),
  };
}

export async function checkDomainNow(
  deps: SenderDeps,
  actor: Actor,
  id: string,
): Promise<
  Ok<{ result: Awaited<ReturnType<typeof checkAndPersistDomain>> }> | Failure
> {
  if (!need(actor, "sender:manage")) return denied;
  const row = await getSenderDomain(deps.db, actor.organizationId, id);
  if (!row) return { ok: false, code: "not_found" };
  return {
    ok: true,
    result: await checkAndPersistDomain(checkDeps(deps), row, actorInfo(actor)),
  };
}

export async function removeDomain(
  deps: SenderDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "sender:manage")) return denied;
  const gone = await deleteSenderDomain(deps.db, actor.organizationId, id);
  if (!gone) return { ok: false, code: "not_found" };
  // Only tear down the provider identity if no other workspace still claims the domain.
  if ((await countSenderDomainClaims(deps.db, gone.domain)) === 0) {
    try {
      await deps.provider.deleteIdentity(gone.domain);
    } catch (error) {
      console.error("[senders] provider deleteIdentity failed", error);
    }
  }
  await audit(deps, actor, "sender_domain.removed", "sender_domain", id, {
    domain: gone.domain,
  });
  return { ok: true };
}

// ---- identities ----------------------------------------------------------------------------------

export type IdentityView = {
  id: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  isDefault: boolean;
  /** Real campaigns may be sent from this identity (its domain, or a parent, is verified). */
  usable: boolean;
  domain: { id: string; domain: string; status: string } | null;
};

function viewIdentities(
  identities: Awaited<ReturnType<typeof listSenderIdentities>>,
  domains: SenderDomain[],
): IdentityView[] {
  // Only a VERIFIED domain makes an identity usable; others merely explain why it is not.
  const verified = domains.filter((d) => d.status === "verified");
  return identities.map((i) => {
    const emailDomain = domainOfEmail(i.fromEmail);
    const cover = emailDomain ? findCoveringDomain(verified, emailDomain) : null;
    const claimed = emailDomain ? findCoveringDomain(domains, emailDomain) : null;
    const shown = cover ?? claimed;
    return {
      id: i.id,
      fromName: i.fromName,
      fromEmail: i.fromEmail,
      replyTo: i.replyTo,
      isDefault: i.isDefault,
      usable: Boolean(cover),
      domain: shown
        ? { id: shown.id, domain: shown.domain, status: shown.status }
        : null,
    };
  });
}

export async function listIdentities(deps: SenderDeps, actor: Actor) {
  if (!need(actor, "campaigns:read")) return denied;
  const [identities, domains] = await Promise.all([
    listSenderIdentities(deps.db, actor.organizationId),
    listSenderDomains(deps.db, actor.organizationId),
  ]);
  return { ok: true as const, identities: viewIdentities(identities, domains) };
}

function validateFrom(deps: SenderDeps, input: SenderIdentityInput): Failure | null {
  const domain = domainOfEmail(input.fromEmail);
  if (!domain)
    return {
      ok: false,
      code: "invalid",
      message: "Geçerli bir gönderici e-posta adresi girin.",
    };
  if (isFreeMailDomain(domain))
    return {
      ok: false,
      code: "free_mail",
      message:
        "Gmail, Outlook, Yahoo gibi ücretsiz adresler gönderici olarak kullanılamaz (alıcı sunucular bu e-postaları reddeder). Kendi alan adınızdaki bir adres kullanın.",
    };
  if (isPlatformDomain(domain, deps.platformHost))
    return {
      ok: false,
      code: "platform_domain",
      message:
        "Mailory'nin kendi alan adındaki adresler gönderici olarak kullanılamaz.",
    };
  return null;
}

export async function createIdentity(
  deps: SenderDeps,
  actor: Actor,
  input: SenderIdentityInput,
): Promise<Ok<{ id: string }> | Failure> {
  if (!need(actor, "sender:manage")) return denied;
  const invalid = validateFrom(deps, input);
  if (invalid) return invalid;
  const row = await createSenderIdentity(deps.db, actor.organizationId, {
    ...input,
    fromEmail: input.fromEmail.toLowerCase(),
    userId: actor.userId,
  });
  if (!row)
    return {
      ok: false,
      code: "duplicate",
      message: "Bu e-posta adresiyle bir gönderici zaten var.",
    };
  await audit(deps, actor, "sender_identity.created", "sender_identity", row.id);
  return { ok: true, id: row.id };
}

export async function updateIdentity(
  deps: SenderDeps,
  actor: Actor,
  id: string,
  input: SenderIdentityInput,
): Promise<Ok | Failure> {
  if (!need(actor, "sender:manage")) return denied;
  const invalid = validateFrom(deps, input);
  if (invalid) return invalid;
  const result = await updateSenderIdentity(deps.db, actor.organizationId, id, {
    ...input,
    fromEmail: input.fromEmail.toLowerCase(),
  });
  if (result === "duplicate")
    return {
      ok: false,
      code: "duplicate",
      message: "Bu e-posta adresiyle bir gönderici zaten var.",
    };
  if (result === "not_found") return { ok: false, code: "not_found" };
  await audit(deps, actor, "sender_identity.updated", "sender_identity", id);
  return { ok: true };
}

export async function makeDefaultIdentity(
  deps: SenderDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "sender:manage")) return denied;
  if (!(await setDefaultSenderIdentity(deps.db, actor.organizationId, id)))
    return { ok: false, code: "not_found" };
  await audit(deps, actor, "sender_identity.default_changed", "sender_identity", id);
  return { ok: true };
}

export async function removeIdentity(
  deps: SenderDeps,
  actor: Actor,
  id: string,
): Promise<Ok | Failure> {
  if (!need(actor, "sender:manage")) return denied;
  if (!(await getSenderIdentity(deps.db, actor.organizationId, id)))
    return { ok: false, code: "not_found" };
  await deleteSenderIdentity(deps.db, actor.organizationId, id);
  await audit(deps, actor, "sender_identity.deleted", "sender_identity", id);
  return { ok: true };
}

// ---- onboarding ----------------------------------------------------------------------------------

export type OnboardingStep = {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
};

/** Derived from live data each time, so it can never disagree with reality (e.g. after a domain is removed). */
export async function getOnboarding(deps: Pick<SenderDeps, "db">, actor: Actor) {
  const facts = await getOnboardingFacts(deps.db, actor.organizationId);
  const steps: OnboardingStep[] = [
    {
      key: "organization",
      title: "Organizasyonunuzu oluşturun",
      description: "Çalışma alanınız hazır.",
      href: "/settings/members",
      done: true,
    },
    {
      key: "logo",
      title: "Logonuzu ekleyin",
      description: "E-postalarınızda ve marka kitinizde görünür.",
      href: "/brand-kit",
      done: facts.logo,
    },
    {
      key: "brand",
      title: "Marka kitinizi tanımlayın",
      description:
        "Renkler, yazı tipi ve alt bilgi bir kez ayarlanır, her e-postada otomatik kullanılır.",
      href: "/brand-kit",
      done: facts.brandKit,
    },
    {
      key: "sender",
      title: "Gönderici adresinizi ekleyin",
      description: "E-postaların kimin adına gideceğini belirler.",
      href: "/settings/senders",
      done: facts.senderIdentity,
    },
    {
      key: "domain",
      title: "Alan adınızı doğrulayın",
      description: "SPF/DKIM kayıtlarıyla e-postalarınızın spam'e düşmesini önleyin.",
      href: "/settings/domains",
      done: facts.domainVerified,
    },
    {
      key: "contacts",
      title: "Kişilerinizi içe aktarın",
      description: "CSV dosyanızı yükleyin veya tek tek ekleyin.",
      href: "/audience/contacts/import",
      done: facts.contacts,
    },
    {
      key: "template",
      title: "İlk şablonunuzu oluşturun",
      description: "Kütüphaneden hazır bir şablonla başlayın.",
      href: "/templates?tab=library",
      done: facts.template,
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  return {
    ok: true as const,
    steps,
    completed,
    total: steps.length,
    finished: completed === steps.length,
  };
}
