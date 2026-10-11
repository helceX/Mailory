import {
  RATE_LIMITS,
  healthBand,
  reviewRates,
  scoreFindings,
  type Finding,
  type Permission,
} from "@mailory/core";
import {
  checkEntitlement,
  cleanDormantContacts,
  countCleanupCandidates,
  countSentSince,
  recordAudit,
  restoreCleanedContacts,
  getOrgSendLimit,
  listCampaigns,
  listHealth,
  listSenderDomains,
  orgOverview,
  type Database,
} from "@mailory/db";
import { authorize, type Actor } from "../org/service";

export type DeliverabilityDeps = { db: Database; now?: () => Date };
const need = (a: Actor, p: Permission) => authorize(a, p);

export type Action = {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  fix: string;
  href?: string;
};

const HALT_REASONS = new Set(["bounce_rate", "complaint_rate", "sender_unverified"]);

/**
 * The Deliverability Center: where an organization stands as a sender (domains, 30-day outcomes, list quality, limits)
 * and a prioritized to-do list. Everything is derived from data we already hold — no external reputation feed.
 */
export async function getDeliverabilityCenter(deps: DeliverabilityDeps, actor: Actor) {
  if (!need(actor, "analytics:read"))
    return { ok: false as const, code: "forbidden" as const };
  const org = actor.organizationId;
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const [domains, overview, lists, dailyLimit, sentToday, paused] = await Promise.all([
    listSenderDomains(deps.db, org),
    orgOverview(deps.db, org, since),
    listHealth(deps.db, org),
    getOrgSendLimit(deps.db, org),
    countSentSince(deps.db, org, dayStart),
    listCampaigns(deps.db, org, { status: "paused", limit: 20 }),
  ]);

  const rateFindings = reviewRates({
    sent: overview.sent,
    bounced: overview.bounced,
    complained: overview.complained,
    unsubscribed: overview.unsubscribed,
  });
  const actions: Action[] = [];
  const push = (f: Finding, href?: string) =>
    actions.push({
      id: f.code,
      severity: f.severity,
      message: f.message,
      fix: f.fix,
      href,
    });

  if (domains.length === 0)
    actions.push({
      id: "no_domain",
      severity: "critical",
      message: "Henüz gönderici alan adı eklenmemiş.",
      fix: "Kendi alan adınızı ekleyip doğrulayın; gerçek gönderim için zorunludur.",
      href: "/settings/domains",
    });
  for (const d of domains) {
    const link = `/settings/domains/${d.id}`;
    if (d.status !== "verified")
      actions.push({
        id: `domain_${d.id}`,
        severity: d.status === "failed" ? "critical" : "warning",
        message: `${d.domain} alan adı doğrulanmamış (${d.status === "failed" ? "başarısız" : "bekliyor"}).`,
        fix: "DNS kayıtlarını tamamlayın ve 'Şimdi kontrol et'e basın.",
        href: link,
      });
    else {
      if (d.spfState !== "ok")
        actions.push({
          id: `spf_${d.id}`,
          severity: "warning",
          message: `${d.domain}: SPF kaydı doğrulanmadı.`,
          fix: "Alan adı sayfasındaki SPF önerisini ekleyin.",
          href: link,
        });
      if (d.dmarcState !== "ok")
        actions.push({
          id: `dmarc_${d.id}`,
          severity: "warning",
          message: `${d.domain}: DMARC kaydı yok.`,
          fix: "En az `v=DMARC1; p=none` ekleyin; Gmail/Yahoo toplu gönderenlerden bekler.",
          href: link,
        });
    }
  }
  rateFindings.forEach((f) => push(f, "/analytics"));
  for (const c of paused)
    if (c.haltReason && HALT_REASONS.has(c.haltReason))
      actions.push({
        id: `paused_${c.id}`,
        severity: "critical",
        message: `“${c.name}” kampanyası otomatik duraklatıldı (${c.haltReason}).`,
        fix: "Nedeni giderin, ardından kampanyayı devam ettirin.",
        href: `/campaigns/${c.id}`,
      });
  if (lists.bounced + lists.complained > 0 && lists.total > 0)
    actions.push({
      id: "bad_addresses",
      severity: "info",
      message: `${lists.bounced + lists.complained} adres geri döndü/şikayet etti; otomatik bastırıldı.`,
      fix: "Bu adreslere gönderilmez; yeni içe aktarmalarda kaynağı kontrol edin.",
    });
  if (lists.noConsent > 0)
    actions.push({
      id: "no_consent",
      severity:
        lists.noConsent / Math.max(1, lists.subscribed) > 0.25 ? "warning" : "info",
      message: `${lists.noConsent} abonenin açık izin kaydı yok.`,
      fix: "İzin kaynağı/tarihini kaydedin veya izin teyit kampanyası gönderin (KVKK).",
      href: "/audience/contacts",
    });
  const scored = lists.hot + lists.warm + lists.cold + lists.dormant;
  if (scored >= 50 && (lists.cold + lists.dormant) / scored > 0.4)
    actions.push({
      id: "cold_list",
      severity: "warning",
      message: "Listenizin yarıya yakını uzun süredir etkileşimde değil.",
      fix: "Pasif kişileri yeniden etkinleştirme kampanyasına alın; yanıt vermeyenleri çıkarın.",
      href: "/audience/segments",
    });
  if (dailyLimit > 0 && sentToday / dailyLimit > 0.8)
    actions.push({
      id: "limit_near",
      severity: "info",
      message: `Günlük gönderim sınırının %${Math.round((sentToday / dailyLimit) * 100)}'ine ulaşıldı.`,
      fix: "Sınır dolunca kampanyalar ertesi gün otomatik devam eder; artırmak için yönetici ile iletişime geçin.",
    });

  const order = { critical: 0, warning: 1, info: 2 } as const;
  actions.sort((a, b) => order[a.severity] - order[b.severity]);
  const score = scoreFindings(
    actions.map((a) => ({
      code: a.id,
      severity: a.severity,
      message: a.message,
      fix: a.fix,
    })),
  );
  return {
    ok: true as const,
    score,
    band: healthBand(score),
    actions,
    domains: domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      status: d.status,
      spfState: d.spfState,
      dmarcState: d.dmarcState,
      dkimOk: d.dkimOk,
    })),
    rolling: {
      days: 30,
      sent: overview.sent,
      bounced: overview.bounced,
      complained: overview.complained,
      unsubscribed: overview.unsubscribed,
    },
    lists,
    limits: { daily: dailyLimit, sentToday },
    thresholds: RATE_LIMITS,
  };
}

// ---- list cleanup ----------------------------------------------------------------------------------------------

export async function getCleanupFor(deps: DeliverabilityDeps, actor: Actor) {
  if (!need(actor, "analytics:read"))
    return { ok: false as const, code: "forbidden" as const };
  return {
    ok: true as const,
    ...(await countCleanupCandidates(deps.db, actor.organizationId)),
  };
}

/** Retires contacts who ignored 3+ recent emails. Reversible; audited with the count. */
export async function cleanupDormantFor(deps: DeliverabilityDeps, actor: Actor) {
  if (!need(actor, "contacts:write"))
    return { ok: false as const, code: "forbidden" as const };
  const cleaned = await cleanDormantContacts(deps.db, actor.organizationId);
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "contacts.cleaned",
    entityType: "contact",
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { count: cleaned },
  });
  return { ok: true as const, cleaned };
}

/** Brings cleaned contacts back as far as the plan's contact limit allows. */
export async function restoreCleanedFor(deps: DeliverabilityDeps, actor: Actor) {
  if (!need(actor, "contacts:write"))
    return { ok: false as const, code: "forbidden" as const };
  const now = (deps.now ?? (() => new Date()))();
  const room = await checkEntitlement(
    deps.db,
    actor.organizationId,
    "contacts",
    0,
    now,
  );
  const capacity = room.remaining === null ? 1_000_000 : room.remaining;
  const restored = await restoreCleanedContacts(
    deps.db,
    actor.organizationId,
    capacity,
  );
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "contacts.cleaned_restored",
    entityType: "contact",
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { count: restored },
  });
  return {
    ok: true as const,
    restored,
    limited: room.remaining !== null && restored >= capacity,
  };
}
