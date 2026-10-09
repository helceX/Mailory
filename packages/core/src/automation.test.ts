import { describe, expect, it } from "vitest";
import {
  AUTOMATION_LIMITS,
  allSteps,
  defaultStep,
  emailSteps,
  flatten,
  insertStep,
  moveStep,
  newStepId,
  removeStep,
  updateStep,
  validateStructure,
  waitMs,
  type Step,
} from "./automation";

const email = (id: string): Step => ({
  id,
  type: "email",
  templateId: "t",
  senderIdentityId: "s",
  subject: "x",
});
const wait = (
  id: string,
  amount = 1,
  unit: "minutes" | "hours" | "days" = "days",
): Step => ({ id, type: "wait", amount, unit });
const cond = (
  id: string,
  yes: Step[],
  no: Step[],
  kind: "opened_previous" | "has_tag" = "opened_previous",
): Step =>
  kind === "has_tag"
    ? { id, type: "condition", check: { kind, tagId: "t" }, yes, no }
    : { id, type: "condition", check: { kind }, yes, no };

describe("flatten", () => {
  it("links each step to the next in its own sequence; branches are terminal", () => {
    const steps = [
      email("a"),
      wait("b"),
      cond("c", [email("d"), email("e")], [wait("f")]),
      email("z"),
    ];
    const { first, nodes } = flatten(steps);
    expect(first).toBe("a");
    expect(nodes.get("a")!.next).toBe("b");
    expect(nodes.get("c")!.next).toBe("z");
    expect(nodes.get("d")!.next).toBe("e");
    expect(nodes.get("e")!.next).toBeNull(); // end of the yes branch: does not rejoin
    expect(nodes.get("f")!.next).toBeNull();
    expect(allSteps(steps)).toHaveLength(7);
    expect(
      emailSteps(steps)
        .map((s) => s.id)
        .sort(),
    ).toEqual(["a", "d", "e", "z"]);
  });
  it("an empty flow has no first step", () => {
    expect(flatten([]).first).toBeNull();
  });
});

describe("waitMs", () => {
  it("converts units", () => {
    expect(waitMs({ amount: 2, unit: "hours" })).toBe(7_200_000);
    expect(waitMs({ amount: 1, unit: "days" })).toBe(86_400_000);
  });
});

describe("validateStructure", () => {
  const msgs = (s: Step[]) => validateStructure(s).map((i) => i.message);
  it("accepts a normal welcome series", () => {
    expect(
      validateStructure([
        email("a"),
        wait("b", 2),
        cond("c", [email("d")], [wait("e", 1), email("f")]),
      ]),
    ).toEqual([]);
    // a condition on opens right after the email, with no wait, can never be true
    expect(
      msgs([email("a"), cond("c", [email("d")], [])]).some((m) =>
        m.includes("bekleme"),
      ),
    ).toBe(true);
  });
  it("needs at least one email, and at least one step", () => {
    expect(msgs([])).toContain("En az bir adım ekleyin.");
    expect(msgs([wait("a")])).toContain("Akışta en az bir e-posta adımı olmalı.");
  });
  it("bounds waits", () => {
    expect(msgs([email("a"), wait("b", 0, "minutes")])).toContain(
      "Bekleme süresi en az 1 dakika olmalı.",
    );
    expect(
      msgs([email("a"), wait("b", 400, "days")]).some((m) =>
        m.includes("en fazla 365"),
      ),
    ).toBe(true);
    expect(msgs([email("a"), wait("b", Number.NaN)]).length).toBeGreaterThan(0);
  });
  it("'opened previous' needs an earlier email on the path", () => {
    expect(msgs([cond("c", [email("a")], [], "opened_previous")])).toContain(
      "Bu koşul için öncesinde bir e-posta adımı olmalı.",
    );
    expect(msgs([email("a"), wait("w"), cond("c", [email("b")], [])])).toEqual([]);
    // an email inside the yes-branch counts for conditions nested below it
    expect(
      msgs([
        email("a"),
        wait("w"),
        cond("c", [email("b"), wait("w2"), cond("d", [email("x")], [])], []),
      ]),
    ).toEqual([]);
    // but a different branch's email does not
    expect(
      msgs([
        cond(
          "c",
          [email("a")],
          [cond("d", [email("b")], [], "opened_previous")],
          "has_tag",
        ),
      ]).some((m) => m.includes("öncesinde")),
    ).toBe(true);
  });
  it("limits nesting depth, total steps, emails, duplicates and empty conditions", () => {
    let inner: Step[] = [email("leaf")];
    for (let i = 0; i < AUTOMATION_LIMITS.maxDepth + 1; i++)
      inner = [cond(`c${i}`, inner, [], "has_tag")];
    expect(msgs(inner).some((m) => m.includes("iç içe"))).toBe(true);
    expect(msgs([email("a"), email("a")])).toContain("Adım kimliği tekrar ediyor.");
    expect(msgs([email("a"), cond("c", [], [], "has_tag")])).toContain(
      "Koşulun en az bir dalında adım olmalı.",
    );
    const many = Array.from({ length: AUTOMATION_LIMITS.maxSteps + 1 }, (_, i) =>
      wait(`w${i}`),
    );
    expect(
      msgs([email("e"), ...many]).some((m) => m.includes("En fazla 20 adım")),
    ).toBe(true);
    const emails = Array.from({ length: AUTOMATION_LIMITS.maxEmails + 1 }, (_, i) =>
      email(`m${i}`),
    );
    expect(msgs(emails).some((m) => m.includes("e-posta adımı olabilir"))).toBe(true);
  });
});

describe("tree edits are immutable and reach into branches", () => {
  const tree = (): Step[] => [
    email("a"),
    cond("c", [email("y1")], [wait("n1")], "has_tag"),
    email("z"),
  ];
  it("updateStep changes one step anywhere", () => {
    const t = tree();
    const out = updateStep(t, "n1", (s) =>
      s.type === "wait" ? { ...s, amount: 9 } : s,
    );
    expect(flatten(out).nodes.get("n1")!.step).toMatchObject({ amount: 9 });
    expect(flatten(t).nodes.get("n1")!.step).toMatchObject({ amount: 1 }); // original untouched
  });
  it("removeStep drops a step (and a condition takes its branches with it)", () => {
    expect(allSteps(removeStep(tree(), "y1")).map((s) => s.id)).toEqual([
      "a",
      "c",
      "n1",
      "z",
    ]);
    expect(allSteps(removeStep(tree(), "c")).map((s) => s.id)).toEqual(["a", "z"]);
  });
  it("insertStep targets the root or a specific branch, at an index", () => {
    const root = insertStep(tree(), { parentId: null, branch: null }, email("new"), 1);
    expect(root.map((s) => s.id)).toEqual(["a", "new", "c", "z"]);
    const yes = insertStep(tree(), { parentId: "c", branch: "yes" }, email("y2"));
    const c = yes[1]!;
    expect(c.type === "condition" && c.yes.map((s) => s.id)).toEqual(["y1", "y2"]);
    expect(c.type === "condition" && c.no.map((s) => s.id)).toEqual(["n1"]);
    // inserting into a non-condition parent is a no-op
    expect(insertStep(tree(), { parentId: "a", branch: "yes" }, email("x"))).toEqual(
      tree(),
    );
  });
  it("moveStep swaps within the same sequence and stops at the edges", () => {
    expect(moveStep(tree(), "z", -1).map((s) => s.id)).toEqual(["a", "z", "c"]);
    expect(moveStep(tree(), "a", -1).map((s) => s.id)).toEqual(["a", "c", "z"]);
    const t = insertStep(tree(), { parentId: "c", branch: "yes" }, email("y2"));
    const moved = moveStep(t, "y2", -1)[1]!;
    expect(moved.type === "condition" && moved.yes.map((s) => s.id)).toEqual([
      "y2",
      "y1",
    ]);
  });
  it("defaults produce valid-shaped steps with unique ids", () => {
    expect(defaultStep("wait")).toMatchObject({
      type: "wait",
      amount: 1,
      unit: "days",
    });
    expect(defaultStep("condition")).toMatchObject({
      type: "condition",
      yes: [],
      no: [],
    });
    expect(defaultStep("email", { templateId: "t" })).toMatchObject({
      templateId: "t",
    });
    expect(new Set(Array.from({ length: 50 }, newStepId)).size).toBe(50);
  });
});
