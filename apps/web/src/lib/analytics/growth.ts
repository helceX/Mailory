import { impactNextAction } from "@mailory/core";
import {
  outcomeSignals,
  listCampaigns,
  recentImpactCampaigns,
  countSendable,
  getOnboardingFacts,
  campaignImpactReport,
  type Database,
} from "@mailory/db";
import { authorize, type Actor } from "../org/service";
export async function getOutcomeSignalsFor(
  deps: { db: Database; now?: () => Date },
  actor: Actor,
) {
  if (!authorize(actor, "analytics:read"))
    return { ok: false as const, code: "forbidden" };
  return {
    ok: true as const,
    signals: await outcomeSignals(
      deps.db,
      actor.organizationId,
      (deps.now ?? (() => new Date()))(),
    ),
  };
}
export async function getGrowthOverview(
  deps: { db: Database; now?: () => Date },
  actor: Actor,
) {
  if (!authorize(actor, "analytics:read") || !authorize(actor, "campaigns:read"))
    return { ok: false as const, code: "forbidden" };
  const now = (deps.now ?? (() => new Date()))();
  const [signals, drafts, measured, facts, sendable] = await Promise.all([
    outcomeSignals(deps.db, actor.organizationId, now),
    listCampaigns(deps.db, actor.organizationId, { status: "draft", limit: 1 }),
    recentImpactCampaigns(deps.db, actor.organizationId),
    getOnboardingFacts(deps.db, actor.organizationId),
    countSendable(deps.db, actor.organizationId, {}),
  ]);
  const experiments = await Promise.all(
    measured.map(async (c) => ({
      id: c.id,
      name: c.name,
      report: await campaignImpactReport(deps.db, actor.organizationId, c.id, now),
      action: "",
    })),
  );
  for (const e of experiments)
    if (e.report)
      e.action = impactNextAction(
        e.report.status,
        measured.find((c) => c.id === e.id)!.audience!.impact!.controlPercent,
      );
  const draft = drafts[0];
  const writable = authorize(actor, "campaigns:write");
  const latest = experiments.find((e) => e.report);
  const active = experiments.find((e) => e.report?.status === "collecting");
  const action = !writable
    ? {
        title: "Sonuçları inceleyin",
        detail: "Kampanya sonuçlarını ekibinizle değerlendirin.",
        href: "/campaigns",
      }
    : !facts.domainVerified
      ? {
          title: "Gönderici alan adını doğrulayın",
          detail:
            "İlk gönderim öncesinde alan adı ve DNS kontrollerini yetkili ekip üyenizle tamamlayın.",
          href: "/settings/domains",
        }
      : !facts.senderIdentity
        ? {
            title: "Gönderici adresinizi ekleyin",
            detail:
              "Kampanyaların hangi doğrulanmış adres adına gönderileceğini belirleyin.",
            href: "/settings/senders",
          }
        : sendable === 0
          ? {
              title: "Gönderilebilir kişilerinizi ekleyin",
              detail:
                "İçe aktarma ile izinli hedef kitlenizi kurun; abonelikten çıkanları geri eklemeyin.",
              href: "/audience/contacts/import",
            }
          : active
            ? {
                title: "Aktif ölçümünüzü izleyin",
                detail:
                  "Sonuç penceresi açık. Bu kitleye yeni gönderim planlamadan önce çakışma riskini değerlendirin.",
                href: `/campaigns/${active.id}`,
              }
            : draft
              ? {
                  title: "Hazır taslağınızı tamamlayın",
                  detail:
                    "Yeni kampanya açmadan önce konu, kitle ve test önizlemesini gözden geçirin.",
                  href: `/campaigns/${draft.id}`,
                }
              : latest
                ? {
                    title: "Ölçümden sonraki kararınızı verin",
                    detail: latest.action,
                    href: `/campaigns/${latest.id}`,
                  }
                : writable
                  ? {
                      title: "Bir iş hedefiyle başlayın",
                      detail:
                        "Demo talebi, ilk satış veya geri dönüş için düzenlenebilir bir başlangıç hazırlayın.",
                      href: "/campaigns?playbook=demo",
                    }
                  : {
                      title: "Sonuçları inceleyin",
                      detail: "Kampanya sonuçlarını ekibinizle değerlendirin.",
                      href: "/campaigns",
                    };
  return {
    ok: true as const,
    signals,
    experiments,
    action,
    sendable,
    measurement:
      signals.length === 0
        ? {
            title: "Sonuç verisi henüz gelmiyor",
            detail:
              "Son 14 günde olay alınmadı. Satın alma veya demo olaylarını bağlayarak kampanya sonucunu ölçün.",
          }
        : {
            title: "Sonuç olayları alınıyor",
            detail:
              "Bu kayıtlar veri geldiğini gösterir; iki grubun bütün olaylarının kapsandığını tek başına doğrulamaz.",
          },
  };
}
