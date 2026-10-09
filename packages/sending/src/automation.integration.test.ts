import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activateAutomation,
  asOrganizationId,
  automationEnrollments,
  automations,
  campaignRecipients,
  campaigns,
  contactTags,
  contacts,
  createAutomation,
  createContact,
  createDb,
  createSenderDomain,
  enrollContacts,
  listStepCampaigns,
  senderDomains,
  setAutomationStatus,
  suppressForEvent,
  updateAutomationDraft,
  tags,
  lists,
  listContactLinks,
  type Automation,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { DEFAULT_BRAND, type AutomationTrigger, type Step } from "@mailory/core";
import {
  blankTemplate,
  type EmailTransport,
  type OutgoingEmail,
  type SendOutcome,
} from "@mailory/email";
import {
  automationTick,
  enrollTriggers,
  processEnrollments,
  type AutomationDeps,
} from "./automation";
import { tick, type EngineDeps } from "./engine";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const DAY = 86_400_000;

class Capture implements EmailTransport {
  readonly name = "capture";
  sent: OutgoingEmail[] = [];
  async send(m: OutgoingEmail): Promise<SendOutcome> {
    this.sent.push(m);
    return { ok: true, messageId: `m-${randomUUID()}` };
  }
}

suite("automation engine (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let clock: Date;
  beforeAll(() => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
  });
  afterAll(async () => end());

  const email = (id: string, subject = id): Step => ({
    id,
    type: "email",
    templateId: "t",
    senderIdentityId: "s",
    subject,
  });
  const wait = (id: string, days: number): Step => ({
    id,
    type: "wait",
    amount: days,
    unit: "days",
  });

  async function setup(
    steps: Step[],
    trigger: AutomationTrigger = { type: "contact_created" },
    activate = true,
  ) {
    clock = new Date();
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const domain = `au-${randomUUID().slice(0, 8)}.com`;
    const d = (await createSenderDomain(db, oid, {
      domain,
      provider: "mock",
      dkimTokens: ["a", "b", "c"],
      ownershipToken: "t".repeat(32),
      userId: user.id,
    }))!;
    await db
      .update(senderDomains)
      .set({ status: "verified" })
      .where(eq(senderDomains.id, d.id));
    const before = [];
    for (let i = 0; i < 2; i++)
      before.push(
        (await createContact(db, oid, {
          email: `old${i}-${randomUUID().slice(0, 5)}@example.org`,
          firstName: `Eski${i}`,
        }))!,
      );
    const a = await createAutomation(db, oid, {
      name: "Karşılama",
      trigger,
      userId: user.id,
    });
    await updateAutomationDraft(db, oid, a.id, { steps });
    let automation: Automation = (
      await db.select().from(automations).where(eq(automations.id, a.id))
    )[0]!;
    if (activate) {
      const collect = (seq: Step[]): Step[] =>
        seq.flatMap((st) =>
          st.type === "condition" ? [st, ...collect(st.yes), ...collect(st.no)] : [st],
        );
      const mails = collect(steps).filter((st) => st.type === "email");
      await new Promise((r) => setTimeout(r, 15));
      clock = new Date(); // activation instant: contacts created before it must never be enrolled
      await activateAutomation(
        db,
        oid,
        a.id,
        mails.map((st) => ({
          stepId: st.id,
          name: `Karşılama · ${st.id}`,
          subject: st.type === "email" ? st.subject : "",
          preheader: "",
          senderIdentityId: null,
          templateId: null,
          templateVersionId: null,
          snapshot: {
            doc: blankTemplate(DEFAULT_BRAND),
            version: 1,
            brand: DEFAULT_BRAND,
            sender: { fromName: "Acme", fromEmail: `info@${domain}`, replyTo: null },
            audienceCount: 0,
            takenAt: clock.toISOString(),
          },
        })),
        clock,
      );
      await new Promise((r) => setTimeout(r, 15));
      automation = (
        await db.select().from(automations).where(eq(automations.id, a.id))
      )[0]!;
    }
    return { user, org, oid, domain, before, automation };
  }
  const adeps = (org: string): AutomationDeps => ({
    db,
    now: () => clock,
    scope: { organizationId: org },
  });
  const edeps = (org: string, transport: EmailTransport): EngineDeps => ({
    db,
    transport,
    appUrl: "https://app.test",
    secret: "k".repeat(48),
    now: () => clock,
    sleep: async () => {},
    ratePerSecond: 1000,
    scope: { organizationId: org },
  });
  const enrollments = (id: string) =>
    db
      .select()
      .from(automationEnrollments)
      .where(eq(automationEnrollments.automationId, id));
  const newContact = async (s: Awaited<ReturnType<typeof setup>>, tag = "n") =>
    (await createContact(db, s.oid, {
      email: `${tag}-${randomUUID().slice(0, 6)}@example.org`,
      firstName: "Yeni",
    }))!;
  const recipientsOf = async (automationId: string, stepId: string) => {
    const [c] = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.automationId, automationId),
          eq(campaigns.automationStepId, stepId),
        ),
      );
    return db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, c!.id));
  };

  it("enrols only contacts that appear after activation, once, and only if eligible", async () => {
    const s = await setup([email("a")]);
    expect(await enrollTriggers(adeps(s.org.id))).toBe(0); // pre-existing audience is never mailed
    const fresh = await newContact(s);
    const unsub = await newContact(s, "u");
    await db
      .update(contacts)
      .set({ status: "unsubscribed" })
      .where(eq(contacts.id, unsub.id));
    const supp = await newContact(s, "s");
    await suppressForEvent(db, s.oid, supp.email, "complaint");
    await db
      .update(contacts)
      .set({ status: "subscribed" })
      .where(eq(contacts.id, supp.id));
    expect(await enrollTriggers(adeps(s.org.id))).toBe(1);
    expect(await enrollTriggers(adeps(s.org.id))).toBe(0); // idempotent
    expect((await enrollments(s.automation.id)).map((e) => e.contactId)).toEqual([
      fresh.id,
    ]);
  });

  it("list and tag triggers react to memberships added after activation only", async () => {
    const list = await (async () => {
      const u = await createTestUser(db);
      const o = await createTestOrg(db, u.id);
      return { u, o };
    })();
    void list;
    const s = await setup([email("a")], { type: "manual" }, false);
    const [l] = await db
      .insert(lists)
      .values({ organizationId: s.org.id, name: "Liste" })
      .returning();
    const [t] = await db
      .insert(tags)
      .values({ organizationId: s.org.id, name: "Etiket" })
      .returning();
    await db
      .insert(listContactLinks)
      .values({ listId: l!.id, contactId: s.before[0]!.id, organizationId: s.org.id });
    await db
      .insert(contactTags)
      .values({ tagId: t!.id, contactId: s.before[0]!.id, organizationId: s.org.id });
    await updateAutomationDraft(db, s.oid, s.automation.id, {
      trigger: { type: "list_joined", listId: l!.id },
    });
    const tagAuto = await createAutomation(db, s.oid, {
      name: "Etiketli",
      trigger: { type: "tag_added", tagId: t!.id },
      userId: s.user.id,
    });
    await updateAutomationDraft(db, s.oid, tagAuto.id, { steps: [email("a")] });
    const act = (id: string) =>
      activateAutomation(
        db,
        s.oid,
        id,
        [
          {
            stepId: "a",
            name: "x",
            subject: "x",
            preheader: "",
            senderIdentityId: null,
            templateId: null,
            templateVersionId: null,
            snapshot: {
              doc: blankTemplate(DEFAULT_BRAND),
              version: 1,
              brand: DEFAULT_BRAND,
              sender: { fromName: "A", fromEmail: `i@${s.domain}`, replyTo: null },
              audienceCount: 0,
              takenAt: clock.toISOString(),
            },
          },
        ],
        clock,
      );
    await new Promise((r) => setTimeout(r, 15));
    clock = new Date();
    await act(s.automation.id);
    await act(tagAuto.id);
    expect(await enrollTriggers(adeps(s.org.id))).toBe(0); // memberships older than activation
    await new Promise((r) => setTimeout(r, 20));
    await db
      .insert(listContactLinks)
      .values({ listId: l!.id, contactId: s.before[1]!.id, organizationId: s.org.id });
    await db
      .insert(contactTags)
      .values({ tagId: t!.id, contactId: s.before[1]!.id, organizationId: s.org.id });
    expect(await enrollTriggers(adeps(s.org.id))).toBe(2); // one per automation
  });

  it("sends the first email through the normal engine; waits; branches on opens; completes", async () => {
    const steps: Step[] = [
      email("a", "Hoş geldin {{first_name|dost}}"),
      wait("w1", 2),
      {
        id: "c",
        type: "condition",
        check: { kind: "opened_previous" },
        yes: [email("yes", "Teşekkürler")],
        no: [wait("w2", 1), email("no", "Hatırlatma")],
      },
    ];
    const s = await setup(steps);
    const t = new Capture();
    const opener = await newContact(s, "o");
    const ghost = await newContact(s, "g");
    await automationTick(adeps(s.org.id));
    // email A is queued for both, then the flow waits 2 days
    const aRecs = await recipientsOf(s.automation.id, "a");
    expect(aRecs).toHaveLength(2);
    let es = await enrollments(s.automation.id);
    expect(es.every((e) => e.status === "active" && e.currentStepId === "c")).toBe(
      true,
    );
    expect(es.every((e) => e.nextRunAt.getTime() === clock.getTime() + 2 * DAY)).toBe(
      true,
    );
    // the ordinary send tick delivers it, and an automation step campaign is never "completed"
    await tick(edeps(s.org.id, t));
    expect(t.sent.map((m) => m.subject).sort()).toEqual([
      "Hoş geldin Yeni",
      "Hoş geldin Yeni",
    ]);
    const [stepCampaign] = await listStepCampaigns(db, s.oid, s.automation.id).then(
      (r) => r.filter((c) => c.automationStepId === "a"),
    );
    expect(stepCampaign!.status).toBe("sending");
    // not due yet
    expect((await automationTick(adeps(s.org.id))).processed).toBe(0);
    // the opener opens; the ghost does not
    await db
      .update(campaignRecipients)
      .set({ openedAt: new Date() })
      .where(eq(campaignRecipients.contactId, opener.id));
    clock = new Date(clock.getTime() + 2 * DAY + 1000);
    await automationTick(adeps(s.org.id));
    es = await enrollments(s.automation.id);
    const byContact = Object.fromEntries(es.map((e) => [e.contactId, e]));
    expect(byContact[opener.id]).toMatchObject({ status: "completed" });
    expect(
      (await recipientsOf(s.automation.id, "yes")).map((r) => r.contactId),
    ).toEqual([opener.id]);
    expect(byContact[ghost.id]).toMatchObject({
      status: "active",
      currentStepId: "no",
    });
    expect(byContact[ghost.id]!.nextRunAt.getTime()).toBe(clock.getTime() + DAY);
    clock = new Date(clock.getTime() + DAY + 1000);
    await automationTick(adeps(s.org.id));
    expect((await recipientsOf(s.automation.id, "no")).map((r) => r.contactId)).toEqual(
      [ghost.id],
    );
    expect(
      (await enrollments(s.automation.id)).every((e) => e.status === "completed"),
    ).toBe(true);
    await tick(edeps(s.org.id, t));
    expect(t.sent.map((m) => m.subject)).toEqual(
      expect.arrayContaining(["Teşekkürler", "Hatırlatma"]),
    );
  });

  it("an unsubscribe ends the flow before the next email", async () => {
    const s = await setup([email("a"), wait("w", 1), email("b")]);
    const c = await newContact(s);
    await automationTick(adeps(s.org.id));
    await db
      .update(contacts)
      .set({ status: "unsubscribed" })
      .where(eq(contacts.id, c.id));
    clock = new Date(clock.getTime() + DAY + 1000);
    await automationTick(adeps(s.org.id));
    expect((await enrollments(s.automation.id))[0]).toMatchObject({
      status: "exited",
      exitReason: "no_longer_subscribed",
    });
    expect(await recipientsOf(s.automation.id, "b")).toHaveLength(0);
  });

  it("parallel workers process each enrolment exactly once (lease)", async () => {
    const s = await setup([email("a"), wait("w", 1), email("b")]);
    for (let i = 0; i < 25; i++) await newContact(s, `p${i}`);
    await enrollTriggers(adeps(s.org.id));
    await Promise.all([1, 2, 3, 4].map(() => processEnrollments(adeps(s.org.id), 10)));
    for (let i = 0; i < 5; i++) await processEnrollments(adeps(s.org.id), 10);
    expect(await recipientsOf(s.automation.id, "a")).toHaveLength(25);
    expect(
      (await enrollments(s.automation.id)).every((e) => e.currentStepId === "b"),
    ).toBe(true);
  });

  it("drains a backlog larger than one batch in a single call, unless the time budget is spent", async () => {
    const s = await setup([email("a"), wait("w", 1), email("b")]);
    for (let i = 0; i < 7; i++) await newContact(s, `d${i}`);
    await enrollTriggers(adeps(s.org.id));
    const first = await processEnrollments(adeps(s.org.id), 2, 0); // budget 0: one batch only
    expect(first.processed).toBe(2);
    const rest = await processEnrollments(adeps(s.org.id), 2);
    expect(rest.processed).toBe(5);
    expect(await recipientsOf(s.automation.id, "a")).toHaveLength(7);
  });

  it("a paused automation does nothing and resumes cleanly", async () => {
    const s = await setup([email("a")]);
    const c = await newContact(s);
    await enrollTriggers(adeps(s.org.id));
    expect(
      (await setAutomationStatus(db, s.oid, s.automation.id, ["active"], "paused"))
        ?.status,
    ).toBe("paused");
    expect((await processEnrollments(adeps(s.org.id))).processed).toBe(0);
    expect(await recipientsOf(s.automation.id, "a")).toHaveLength(0);
    await setAutomationStatus(db, s.oid, s.automation.id, ["paused"], "active");
    clock = new Date(clock.getTime() + 10 * 60_000); // past the lease
    expect((await processEnrollments(adeps(s.org.id))).completed).toBe(1);
    expect((await recipientsOf(s.automation.id, "a")).map((r) => r.contactId)).toEqual([
      c.id,
    ]);
  });

  it("manual enrolment respects eligibility, is idempotent, and never crosses tenants", async () => {
    const s = await setup([email("a")], { type: "manual" });
    const other = await setup([email("a")], { type: "manual" });
    expect(await enrollContacts(db, s.oid, s.automation.id, {}, "a", clock)).toBe(2);
    expect(await enrollContacts(db, s.oid, s.automation.id, {}, "a", clock)).toBe(0);
    expect(await enrollments(other.automation.id)).toHaveLength(0);
    await processEnrollments(adeps(s.org.id));
    expect(await recipientsOf(s.automation.id, "a")).toHaveLength(2);
    expect(await recipientsOf(other.automation.id, "a")).toHaveLength(0);
  });

  it("the structure of a started automation is frozen", async () => {
    const s = await setup([email("a")]);
    expect(
      await updateAutomationDraft(db, s.oid, s.automation.id, {
        steps: [email("zzz")],
      }),
    ).toBeNull();
  });
});
