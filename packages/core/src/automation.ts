/**
 * Automation definitions: a trigger and a tree of steps. Flows are deliberately simple and safe — no loops, branches
 * are terminal (they do not rejoin), and every definition is validated against hard limits before it can go live.
 */
export type AutomationTrigger =
  | { type: "contact_created" }
  | { type: "list_joined"; listId: string }
  | { type: "tag_added"; tagId: string }
  | { type: "manual" };

export type WaitUnit = "minutes" | "hours" | "days";
export type EmailStep = {
  id: string;
  type: "email";
  templateId: string;
  senderIdentityId: string;
  subject: string;
  preheader?: string;
};
export type WaitStep = { id: string; type: "wait"; amount: number; unit: WaitUnit };
export type ConditionCheck =
  | { kind: "opened_previous" }
  | { kind: "clicked_previous" }
  | { kind: "has_tag"; tagId: string }
  | { kind: "in_list"; listId: string };
export type ConditionStep = {
  id: string;
  type: "condition";
  check: ConditionCheck;
  yes: Step[];
  no: Step[];
};
export type Step = EmailStep | WaitStep | ConditionStep;

export const AUTOMATION_LIMITS = {
  maxSteps: 20,
  maxEmails: 10,
  maxDepth: 3,
  minWaitMinutes: 1,
  maxWaitDays: 365,
} as const;

export const AUTOMATION_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];
export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  draft: "Taslak",
  active: "Etkin",
  paused: "Duraklatıldı",
  archived: "Arşivlendi",
};
export const TRIGGER_LABELS: Record<AutomationTrigger["type"], string> = {
  contact_created: "Yeni kişi eklendiğinde",
  list_joined: "Bir listeye eklendiğinde",
  tag_added: "Bir etiket eklendiğinde",
  manual: "Elle kayıt (kişileri ben seçerim)",
};

export const UNIT_MS: Record<WaitUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};
export const waitMs = (s: Pick<WaitStep, "amount" | "unit">) =>
  s.amount * UNIT_MS[s.unit];

export type Flat = Map<string, { step: Step; next: string | null }>;

/** id → step and the id that follows it in its own sequence (null at the end of a sequence / branch). */
export function flatten(steps: Step[]): { first: string | null; nodes: Flat } {
  const nodes: Flat = new Map();
  const walk = (seq: Step[]) => {
    seq.forEach((step, i) => {
      nodes.set(step.id, { step, next: seq[i + 1]?.id ?? null });
      if (step.type === "condition") {
        walk(step.yes);
        walk(step.no);
      }
    });
  };
  walk(steps);
  return { first: steps[0]?.id ?? null, nodes };
}

export function allSteps(steps: Step[]): Step[] {
  return [...flatten(steps).nodes.values()].map((n) => n.step);
}
export const emailSteps = (steps: Step[]) =>
  allSteps(steps).filter((s): s is EmailStep => s.type === "email");

export type DefinitionIssue = { stepId: string | null; message: string };

/** Structural rules only (references to templates/senders are checked by the service against the database). */
export function validateStructure(steps: Step[]): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const seen = new Set<string>();
  let total = 0;
  const walk = (
    seq: Step[],
    depth: number,
    emailBefore: boolean,
    waitedBefore: boolean,
  ) => {
    let hadEmail = emailBefore;
    // Has the flow waited since the most recent email? Opens/clicks cannot exist the instant a mail is queued.
    let waited = waitedBefore;
    for (const s of seq) {
      total++;
      if (seen.has(s.id))
        issues.push({ stepId: s.id, message: "Adım kimliği tekrar ediyor." });
      seen.add(s.id);
      if (s.type === "email") {
        hadEmail = true;
        waited = false;
      }
      if (s.type === "wait") {
        waited = true;
        const minutes = waitMs(s) / 60_000;
        if (!Number.isFinite(minutes) || minutes < AUTOMATION_LIMITS.minWaitMinutes)
          issues.push({
            stepId: s.id,
            message: "Bekleme süresi en az 1 dakika olmalı.",
          });
        if (minutes > AUTOMATION_LIMITS.maxWaitDays * 1440)
          issues.push({
            stepId: s.id,
            message: `Bekleme süresi en fazla ${AUTOMATION_LIMITS.maxWaitDays} gün olabilir.`,
          });
      }
      if (s.type === "condition") {
        if (depth >= AUTOMATION_LIMITS.maxDepth)
          issues.push({
            stepId: s.id,
            message: `Koşullar en fazla ${AUTOMATION_LIMITS.maxDepth} kat iç içe olabilir.`,
          });
        if (
          (s.check.kind === "opened_previous" || s.check.kind === "clicked_previous") &&
          !hadEmail
        )
          issues.push({
            stepId: s.id,
            message: "Bu koşul için öncesinde bir e-posta adımı olmalı.",
          });
        else if (
          (s.check.kind === "opened_previous" || s.check.kind === "clicked_previous") &&
          !waited
        )
          issues.push({
            stepId: s.id,
            message:
              "Açılma/tıklama koşulundan önce bir bekleme adımı koyun; e-posta gönderilir gönderilmez kimse açmış olamaz.",
          });
        if (s.yes.length === 0 && s.no.length === 0)
          issues.push({
            stepId: s.id,
            message: "Koşulun en az bir dalında adım olmalı.",
          });
        walk(s.yes, depth + 1, hadEmail, waited);
        walk(s.no, depth + 1, hadEmail, waited);
      }
    }
  };
  walk(steps, 1, false, false);
  if (steps.length === 0)
    issues.push({ stepId: null, message: "En az bir adım ekleyin." });
  if (total > AUTOMATION_LIMITS.maxSteps)
    issues.push({
      stepId: null,
      message: `En fazla ${AUTOMATION_LIMITS.maxSteps} adım olabilir.`,
    });
  const emails = emailSteps(steps).length;
  if (emails === 0 && steps.length > 0)
    issues.push({ stepId: null, message: "Akışta en az bir e-posta adımı olmalı." });
  if (emails > AUTOMATION_LIMITS.maxEmails)
    issues.push({
      stepId: null,
      message: `En fazla ${AUTOMATION_LIMITS.maxEmails} e-posta adımı olabilir.`,
    });
  return issues;
}

// ---- immutable tree edits used by the builder UI (pure, so they are unit-tested) ---------------------------------

export function newStepId(): string {
  return `s${Math.random().toString(36).slice(2, 10)}`;
}

export type Slot = { parentId: string | null; branch: "yes" | "no" | null };

function mapSeq(seq: Step[], fn: (s: Step) => Step | null): Step[] {
  const out: Step[] = [];
  for (const s of seq) {
    const mapped = fn(s);
    if (mapped === null) continue;
    out.push(
      mapped.type === "condition"
        ? { ...mapped, yes: mapSeq(mapped.yes, fn), no: mapSeq(mapped.no, fn) }
        : mapped,
    );
  }
  return out;
}

export function updateStep(
  steps: Step[],
  id: string,
  patch: (s: Step) => Step,
): Step[] {
  return mapSeq(steps, (s) => (s.id === id ? patch(s) : s));
}
export function removeStep(steps: Step[], id: string): Step[] {
  return mapSeq(steps, (s) => (s.id === id ? null : s));
}
/** Inserts `step` into the top-level sequence or a condition's branch, at `index` (default: the end). */
export function insertStep(
  steps: Step[],
  slot: Slot,
  step: Step,
  index?: number,
): Step[] {
  const put = (seq: Step[]) => {
    const i =
      index === undefined ? seq.length : Math.max(0, Math.min(index, seq.length));
    return [...seq.slice(0, i), step, ...seq.slice(i)];
  };
  if (slot.parentId === null) return put(steps);
  return mapSeq(steps, (s) =>
    s.id === slot.parentId && s.type === "condition" && slot.branch
      ? { ...s, [slot.branch]: put(s[slot.branch]) }
      : s,
  );
}
/** Moves a step one position up/down within its own sequence. */
export function moveStep(steps: Step[], id: string, dir: -1 | 1): Step[] {
  const swap = (seq: Step[]): Step[] => {
    const i = seq.findIndex((s) => s.id === id);
    if (i >= 0) {
      const j = i + dir;
      if (j < 0 || j >= seq.length) return seq;
      const copy = [...seq];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    }
    return seq.map((s) =>
      s.type === "condition" ? { ...s, yes: swap(s.yes), no: swap(s.no) } : s,
    );
  };
  return swap(steps);
}

export function defaultStep(
  type: Step["type"],
  defaults: { templateId?: string; senderIdentityId?: string } = {},
): Step {
  const id = newStepId();
  if (type === "email")
    return {
      id,
      type,
      templateId: defaults.templateId ?? "",
      senderIdentityId: defaults.senderIdentityId ?? "",
      subject: "",
    };
  if (type === "wait") return { id, type, amount: 1, unit: "days" };
  return { id, type, check: { kind: "opened_previous" }, yes: [], no: [] };
}
