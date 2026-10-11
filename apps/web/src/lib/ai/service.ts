import {
  docText,
  analystPrompt,
  draftPrompt,
  parseAnalysis,
  parseDraft,
  parseReview,
  parseSubjects,
  reviewPrompt,
  subjectsPrompt,
  AiError,
  type AiProvider,
} from "@mailory/ai";
import type { EmailDoc, Permission } from "@mailory/core";
import {
  campaignStats,
  compareCampaigns,
  countAiRequestsSince,
  getAiEnabled,
  getCampaign,
  getTemplate,
  recordAiRequest,
  recordAudit,
  setAiEnabled,
  topLinks,
  type Database,
} from "@mailory/db";
import { emailDocSchema } from "@mailory/validation";
import { enforce } from "../billing/enforce";
import { authorize, type Actor } from "../org/service";
import { loadBrandKit } from "../templates/service";
import { createTemplateFor, saveTemplateFor } from "../templates/service";

/*
 * SAFETY CONTRACT (enforced by ai.safety.test.ts): this module only READS campaign/template/stat data and returns
 * suggestions. It imports nothing that can send, schedule, submit, approve, activate or enrol, and nothing it returns
 * is applied automatically — a person has to click. The one write is saving a draft as a NEW template on request.
 */

export type AiDeps = {
  db: Database;
  appUrl: string;
  provider: AiProvider | null;
  dailyLimit: number;
  now?: () => Date;
};
type Code =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "ai_unavailable"
  | "ai_disabled"
  | "limit_reached"
  | "ai_failed"
  | "plan_limit"
  | "duplicate";
export type Failure = { ok: false; code: Code; message?: string };
const fail = (code: Code, message?: string): Failure => ({ ok: false, code, message });
const need = (a: Actor, p: Permission) => authorize(a, p);
const clock = (d: AiDeps) => (d.now ?? (() => new Date()))();

export async function getAiStatus(deps: AiDeps, actor: Actor) {
  if (!need(actor, "campaigns:read")) return fail("forbidden");
  const dayStart = new Date(
    Date.UTC(
      clock(deps).getUTCFullYear(),
      clock(deps).getUTCMonth(),
      clock(deps).getUTCDate(),
    ),
  );
  return {
    ok: true as const,
    available: deps.provider !== null,
    enabled: await getAiEnabled(deps.db, actor.organizationId),
    usedToday: await countAiRequestsSince(deps.db, actor.organizationId, dayStart),
    limit: deps.dailyLimit,
  };
}

export async function setAiEnabledFor(deps: AiDeps, actor: Actor, on: boolean) {
  if (!need(actor, "org:manage_settings")) return fail("forbidden");
  await setAiEnabled(deps.db, actor.organizationId, on);
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "ai.toggled",
    entityType: "organization",
    entityId: actor.organizationId,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: { enabled: on },
  });
  return { ok: true as const, enabled: on };
}

/** Provider present → org opted in → under the daily limit. Returns the failure to show, or null to proceed. */
async function guard(deps: AiDeps, actor: Actor): Promise<Failure | null> {
  if (!deps.provider) return fail("ai_unavailable");
  if (!(await getAiEnabled(deps.db, actor.organizationId))) return fail("ai_disabled");
  const now = clock(deps);
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (
    (await countAiRequestsSince(deps.db, actor.organizationId, dayStart)) >=
    deps.dailyLimit
  )
    return fail("limit_reached");
  const plan = await enforce(deps.db, actor.organizationId, "ai_credits", 1, now);
  if (plan) return plan;
  return null;
}

async function run<T>(
  deps: AiDeps,
  actor: Actor,
  feature: "subjects" | "review" | "analyst" | "draft",
  prompt: { system: string; user: string },
  parse: (text: string) => T | null,
  maxTokens = 1024,
): Promise<{ ok: true; value: T } | Failure> {
  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    const r = await deps.provider!.complete({ feature, ...prompt, maxTokens });
    text = r.text;
    usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  } catch (error) {
    await recordAiRequest(deps.db, actor.organizationId, {
      userId: actor.userId,
      feature,
      ok: false,
    });
    const code = error instanceof AiError ? error.code : "unavailable";
    return fail(
      "ai_failed",
      code === "rate_limited"
        ? "Yapay zekâ sağlayıcısı yoğun; biraz sonra deneyin."
        : undefined,
    );
  }
  const value = parse(text);
  await recordAiRequest(deps.db, actor.organizationId, {
    userId: actor.userId,
    feature,
    ok: value !== null,
    ...usage,
  });
  if (value === null)
    return fail("ai_failed", "Yanıt anlaşılamadı; lütfen tekrar deneyin.");
  return { ok: true, value };
}

async function campaignContent(deps: AiDeps, actor: Actor, id: string) {
  const c = await getCampaign(deps.db, actor.organizationId, id);
  if (!c) return null;
  const t = c.templateId
    ? await getTemplate(deps.db, actor.organizationId, c.templateId)
    : null;
  const parsed = t ? emailDocSchema.safeParse(t.version.doc) : null;
  return { campaign: c, doc: parsed?.success ? (parsed.data as EmailDoc) : null };
}

const AUDIENCE_LABEL = {
  all: "all subscribers",
  list: "a list of subscribers",
  segment: "a segment",
  tag: "tagged contacts",
} as const;

export async function suggestSubjectsFor(
  deps: AiDeps,
  actor: Actor,
  campaignId: string,
) {
  if (!need(actor, "campaigns:write")) return fail("forbidden");
  const ctx = await campaignContent(deps, actor, campaignId);
  if (!ctx) return fail("not_found");
  if (!ctx.doc)
    return fail(
      "invalid",
      "Önce bir şablon seçin; öneriler e-posta içeriğinden üretilir.",
    );
  const blocked = await guard(deps, actor);
  if (blocked) return blocked;
  const r = await run(
    deps,
    actor,
    "subjects",
    subjectsPrompt({
      content: docText(ctx.doc),
      currentSubject: ctx.campaign.subject,
      audience: AUDIENCE_LABEL[ctx.campaign.audience?.kind ?? "all"],
    }),
    parseSubjects,
  );
  return r.ok ? { ok: true as const, suggestions: r.value } : r;
}

export async function reviewCampaignFor(
  deps: AiDeps,
  actor: Actor,
  campaignId: string,
  ruleFindings: string[] = [],
) {
  if (!need(actor, "campaigns:write")) return fail("forbidden");
  const ctx = await campaignContent(deps, actor, campaignId);
  if (!ctx) return fail("not_found");
  if (!ctx.doc) return fail("invalid", "Önce bir şablon seçin.");
  const blocked = await guard(deps, actor);
  if (blocked) return blocked;
  const r = await run(
    deps,
    actor,
    "review",
    reviewPrompt({
      content: docText(ctx.doc),
      subject: ctx.campaign.subject,
      ruleFindings: ruleFindings.slice(0, 12),
    }),
    parseReview,
  );
  return r.ok ? { ok: true as const, review: r.value } : r;
}

/** Plain-language read of the numbers. Only aggregates reach the model. */
export async function analyzeCampaignFor(
  deps: AiDeps,
  actor: Actor,
  campaignId: string,
) {
  if (!need(actor, "analytics:read")) return fail("forbidden");
  const c = await getCampaign(deps.db, actor.organizationId, campaignId);
  if (!c) return fail("not_found");
  if (
    c.status === "draft" ||
    c.status === "pending_approval" ||
    c.status === "scheduled"
  )
    return fail("invalid", "Kampanya henüz gönderilmedi.");
  const blocked = await guard(deps, actor);
  if (blocked) return blocked;
  const [stats, links, all] = await Promise.all([
    campaignStats(deps.db, actor.organizationId, c.id),
    topLinks(deps.db, actor.organizationId, c.id, 5),
    compareCampaigns(deps.db, actor.organizationId, 10),
  ]);
  const prev = all.find(
    (x) =>
      x.id !== c.id &&
      x.startedAt &&
      c.startedAt &&
      x.startedAt < c.startedAt &&
      x.sent >= 50,
  );
  const previousOpenRate = prev
    ? prev.uniqueOpens / (prev.delivered || prev.sent)
    : null;
  const r = await run(
    deps,
    actor,
    "analyst",
    analystPrompt({
      subject: c.subject,
      stats: { ...stats, topLinks: links },
      previousOpenRate,
    }),
    parseAnalysis,
  );
  return r.ok
    ? { ok: true as const, analysis: r.value, basedOn: { sent: stats.sent } }
    : r;
}

const TONES = ["samimi", "profesyonel", "enerjik", "sade"] as const;
export type Tone = (typeof TONES)[number];

/** Returns a proposed draft. Nothing is saved until `saveAiDraftFor` is called by the user. */
export async function draftEmailFor(
  deps: AiDeps,
  actor: Actor,
  input: { brief: string; tone: Tone },
) {
  if (!need(actor, "templates:write")) return fail("forbidden");
  const brief = input.brief.trim();
  if (brief.length < 10 || brief.length > 2000)
    return fail("invalid", "Kısa bir açıklama yazın (10–2000 karakter).");
  if (!TONES.includes(input.tone)) return fail("invalid");
  const blocked = await guard(deps, actor);
  if (blocked) return blocked;
  const brand = await loadBrandKit({ db: deps.db, appUrl: deps.appUrl }, actor);
  const r = await run(
    deps,
    actor,
    "draft",
    draftPrompt({ brief, tone: input.tone }),
    (t) => parseDraft(t, brand),
    2000,
  );
  return r.ok ? { ok: true as const, title: r.value.title, doc: r.value.doc } : r;
}

export async function saveAiDraftFor(
  deps: AiDeps,
  actor: Actor,
  input: { title: string; doc: unknown },
) {
  if (!need(actor, "templates:write")) return fail("forbidden");
  const valid = emailDocSchema.safeParse(input.doc);
  if (!valid.success) return fail("invalid", "Taslak geçersiz.");
  const tdeps = { db: deps.db, appUrl: deps.appUrl };
  let id: string | null = null;
  for (let n = 0; n < 5 && !id; n++) {
    const name = (n === 0 ? input.title : `${input.title} (${n + 1})`).slice(0, 120);
    const created = await createTemplateFor(tdeps, actor, { name, category: "other" });
    if (created.ok) id = created.id;
    else if (created.code !== "duplicate") return fail("invalid", created.message);
  }
  if (!id) return fail("duplicate", "Bu isimde çok sayıda şablon var.");
  const saved = await saveTemplateFor(tdeps, actor, id, {
    doc: valid.data,
    note: "Yapay zekâ taslağı",
  });
  if (!saved.ok) return fail("invalid", saved.message);
  await recordAudit(deps.db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: "ai.draft_saved",
    entityType: "template",
    entityId: id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    metadata: {},
  });
  return { ok: true as const, id };
}
