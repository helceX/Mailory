import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  getMember,
  listMembers,
  auditLogs,
  memberships,
  asOrganizationId,
  type Database,
} from "@mailory/db";
import {
  addTestMember,
  createTestOrg,
  createTestUser,
  createTwoTenants,
} from "@mailory/db/testing";
import type { OrgRole } from "@mailory/core";
import type { SendEmail } from "../auth/service";
import {
  acceptInvitation,
  changeMemberRole,
  createOrganization,
  inviteMember,
  listOrgAudit,
  listOrgInvitations,
  listOrgMembers,
  removeMember,
  revokeInvitation,
  type Actor,
  type OrgDeps,
} from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("organization service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let sent: Parameters<SendEmail>[0][];
  let deps: OrgDeps;
  let now = new Date();

  beforeAll(() => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.pool.end();
  });
  afterAll(async () => end());

  const reset = () => {
    sent = [];
    now = new Date();
    deps = {
      db,
      appUrl: "https://app.test",
      now: () => now,
      sendEmail: async (m) => void sent.push(m),
    };
  };
  const actorFor = (userId: string, organizationId: string, role: OrgRole): Actor => ({
    userId,
    organizationId: asOrganizationId(organizationId),
    role,
  });
  const tokenFrom = (text: string) =>
    new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

  /** An org with one member of each role. */
  async function orgWithAllRoles() {
    reset();
    const owner = await createTestUser(db);
    const org = await createTestOrg(db, owner.id);
    const people = { owner } as Record<
      OrgRole,
      Awaited<ReturnType<typeof createTestUser>>
    >;
    for (const role of ["admin", "editor", "viewer"] as const) {
      people[role] = await createTestUser(db);
      await addTestMember(db, org.id, people[role].id, role);
    }
    const actor = (role: OrgRole) => actorFor(people[role].id, org.id, role);
    return { org, people, actor };
  }

  describe("creation", () => {
    it("creates an org with the creator as its only owner and audits it", async () => {
      reset();
      const user = await createTestUser(db);
      const org = await createOrganization(deps, user.id, "Şişli Girişim");
      expect(org.slug).toMatch(/^sisli-girisim/);
      const members = await listMembers(db, asOrganizationId(org.id));
      expect(members.map((m) => [m.userId, m.role])).toEqual([[user.id, "owner"]]);
      const audit = await listOrgAudit(deps, actorFor(user.id, org.id, "owner"));
      expect(audit.ok && audit.entries.map((e) => e.action)).toContain("org.created");
    });
    it("gives two orgs with the same name different slugs", async () => {
      reset();
      const a = await createTestUser(db);
      const b = await createTestUser(db);
      const one = await createOrganization(deps, a.id, "Acme Duplicate Test");
      const two = await createOrganization(deps, b.id, "Acme Duplicate Test");
      expect(one.slug).not.toBe(two.slug);
    });
  });

  describe("authorization", () => {
    it("only admin and owner can invite; editors and viewers are refused", async () => {
      const { actor } = await orgWithAllRoles();
      for (const role of ["editor", "viewer"] as const) {
        expect(
          await inviteMember(deps, actor(role), {
            email: "x@example.com",
            role: "viewer",
          }),
        ).toEqual({ ok: false, code: "forbidden" });
      }
      expect(
        (
          await inviteMember(deps, actor("admin"), {
            email: "x@example.com",
            role: "viewer",
          })
        ).ok,
      ).toBe(true);
    });
    it("admin cannot invite another admin; owner can", async () => {
      const { actor } = await orgWithAllRoles();
      expect(
        await inviteMember(deps, actor("admin"), {
          email: "a@example.com",
          role: "admin",
        }),
      ).toEqual({ ok: false, code: "forbidden" });
      expect(
        (
          await inviteMember(deps, actor("owner"), {
            email: "a@example.com",
            role: "admin",
          })
        ).ok,
      ).toBe(true);
    });
    it("viewing invitations and audit log needs admin+", async () => {
      const { actor } = await orgWithAllRoles();
      expect(await listOrgInvitations(deps, actor("editor"))).toEqual({
        ok: false,
        code: "forbidden",
      });
      expect(await listOrgAudit(deps, actor("viewer"))).toEqual({
        ok: false,
        code: "forbidden",
      });
      expect((await listOrgAudit(deps, actor("admin"))).ok).toBe(true);
    });
    it("every member can see the member list", async () => {
      const { actor } = await orgWithAllRoles();
      expect(await listOrgMembers(deps, actor("viewer"))).toHaveLength(4);
    });
  });

  describe("role management", () => {
    it("admin can change an editor but not an owner, a peer admin, or escalate anyone to admin", async () => {
      const { people, actor } = await orgWithAllRoles();
      expect(
        (await changeMemberRole(deps, actor("admin"), people.editor.id, "viewer")).ok,
      ).toBe(true);
      expect(
        await changeMemberRole(deps, actor("admin"), people.owner.id, "viewer"),
      ).toEqual({ ok: false, code: "forbidden" });
      expect(
        await changeMemberRole(deps, actor("admin"), people.viewer.id, "admin"),
      ).toEqual({ ok: false, code: "forbidden" });
      const peer = await createTestUser(db);
      await addTestMember(db, actor("admin").organizationId, peer.id, "admin");
      expect(await changeMemberRole(deps, actor("admin"), peer.id, "viewer")).toEqual({
        ok: false,
        code: "forbidden",
      });
    });
    it("an editor cannot change roles at all (including their own)", async () => {
      const { people, actor } = await orgWithAllRoles();
      expect(
        await changeMemberRole(deps, actor("editor"), people.editor.id, "owner"),
      ).toEqual({ ok: false, code: "forbidden" });
    });
    it("the last owner can neither be demoted nor removed, nor leave", async () => {
      const { people, actor } = await orgWithAllRoles();
      expect(
        await changeMemberRole(deps, actor("owner"), people.owner.id, "admin"),
      ).toEqual({ ok: false, code: "last_owner" });
      expect(await removeMember(deps, actor("owner"), people.owner.id)).toEqual({
        ok: false,
        code: "last_owner",
      });
      expect(
        (await getMember(db, actor("owner").organizationId, people.owner.id))?.role,
      ).toBe("owner");
    });
    it("with two owners, one may step down", async () => {
      const { people, actor } = await orgWithAllRoles();
      expect(
        (await changeMemberRole(deps, actor("owner"), people.admin.id, "owner")).ok,
      ).toBe(true);
      expect(
        (await changeMemberRole(deps, actor("owner"), people.owner.id, "admin")).ok,
      ).toBe(true);
    });
    it("role changes wait on the owner-row lock, so concurrent demotions cannot orphan an org", async () => {
      // Deterministic: lock the *other* owner's row (not the demotion target, whose own UPDATE
      // would block anyway) and prove the demotion's owner-count check waits for it. Without
      // FOR UPDATE on the owner rows the demotion finishes immediately and this fails.
      const { people, org } = await orgWithAllRoles();
      await db
        .update(memberships)
        .set({ role: "owner" })
        .where(
          and(
            eq(memberships.organizationId, org.id),
            eq(memberships.userId, people.admin.id),
          ),
        );
      const sleep = (ms: number) =>
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), ms));

      let demotion!: ReturnType<typeof changeMemberRole>;
      let state: unknown;
      await db.transaction(async (tx) => {
        await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, org.id),
              eq(memberships.userId, people.owner.id),
            ),
          )
          .for("update");
        demotion = changeMemberRole(
          deps,
          actorFor(people.owner.id, org.id, "owner"),
          people.admin.id,
          "viewer",
        );
        state = await Promise.race([demotion, sleep(400)]);
      });
      expect(state).toBe("blocked");
      expect((await demotion).ok).toBe(true); // proceeds once the lock is released

      // After it, only one owner remains and that owner can no longer be demoted.
      const owners = (await listMembers(db, asOrganizationId(org.id))).filter(
        (m) => m.role === "owner",
      );
      expect(owners).toHaveLength(1);
      expect(
        await changeMemberRole(
          deps,
          actorFor(owners[0]!.userId, org.id, "owner"),
          owners[0]!.userId,
          "viewer",
        ),
      ).toEqual({
        ok: false,
        code: "last_owner",
      });
    });
  });

  describe("removal", () => {
    it("a member can leave; an editor cannot remove someone else", async () => {
      const { people, actor } = await orgWithAllRoles();
      expect(await removeMember(deps, actor("editor"), people.viewer.id)).toEqual({
        ok: false,
        code: "forbidden",
      });
      expect((await removeMember(deps, actor("editor"), people.editor.id)).ok).toBe(
        true,
      );
      expect(
        await getMember(db, actor("owner").organizationId, people.editor.id),
      ).toBeNull();
    });
    it("removal is recorded in the audit log", async () => {
      const { people, actor } = await orgWithAllRoles();
      await removeMember(deps, actor("admin"), people.viewer.id);
      const audit = await listOrgAudit(deps, actor("owner"));
      expect(
        audit.ok &&
          audit.entries.some(
            (e) => e.action === "member.removed" && e.entityId === people.viewer.id,
          ),
      ).toBe(true);
    });
  });

  describe("invitations", () => {
    it("invite → accept by the invited email → membership with the invited role", async () => {
      const { actor } = await orgWithAllRoles();
      const invitee = await createTestUser(db);
      await inviteMember(deps, actor("admin"), {
        email: invitee.email,
        role: "editor",
      });
      expect(sent[0]!.kind).toBe("invitation");
      const accepted = await acceptInvitation(deps, invitee, tokenFrom(sent[0]!.text));
      expect(accepted).toMatchObject({ ok: true, role: "editor" });
      expect(
        (await getMember(db, actor("owner").organizationId, invitee.id))?.role,
      ).toBe("editor");
    });
    it("a different signed-in user cannot accept someone else's invitation", async () => {
      const { actor } = await orgWithAllRoles();
      const intended = await createTestUser(db);
      const intruder = await createTestUser(db);
      await inviteMember(deps, actor("admin"), {
        email: intended.email,
        role: "viewer",
      });
      expect(await acceptInvitation(deps, intruder, tokenFrom(sent[0]!.text))).toEqual({
        ok: false,
        code: "email_mismatch",
      });
      expect(
        await getMember(db, actor("owner").organizationId, intruder.id),
      ).toBeNull();
    });
    it("invitations are single-use, expire, and can be revoked", async () => {
      const { actor } = await orgWithAllRoles();
      const a = await createTestUser(db);
      await inviteMember(deps, actor("admin"), { email: a.email, role: "viewer" });
      const token = tokenFrom(sent[0]!.text);
      expect((await acceptInvitation(deps, a, token)).ok).toBe(true);
      expect(await acceptInvitation(deps, a, token)).toMatchObject({ ok: false });

      const b = await createTestUser(db);
      await inviteMember(deps, actor("admin"), { email: b.email, role: "viewer" });
      const expiring = tokenFrom(sent[1]!.text);
      now = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
      expect(await acceptInvitation(deps, b, expiring)).toEqual({
        ok: false,
        code: "not_found",
      });

      now = new Date();
      const c = await createTestUser(db);
      const invited = await inviteMember(deps, actor("admin"), {
        email: c.email,
        role: "viewer",
      });
      if (!invited.ok) throw new Error("invite failed");
      expect(
        (await revokeInvitation(deps, actor("admin"), invited.invitationId)).ok,
      ).toBe(true);
      expect(await acceptInvitation(deps, c, tokenFrom(sent[2]!.text))).toEqual({
        ok: false,
        code: "not_found",
      });
    });
    it("re-inviting the same email invalidates the older link", async () => {
      const { actor } = await orgWithAllRoles();
      const u = await createTestUser(db);
      await inviteMember(deps, actor("admin"), { email: u.email, role: "viewer" });
      await inviteMember(deps, actor("admin"), { email: u.email, role: "editor" });
      expect(await acceptInvitation(deps, u, tokenFrom(sent[0]!.text))).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await acceptInvitation(deps, u, tokenFrom(sent[1]!.text))).toMatchObject({
        ok: true,
        role: "editor",
      });
    });
    it("existing members cannot be invited again", async () => {
      const { people, actor } = await orgWithAllRoles();
      expect(
        await inviteMember(deps, actor("admin"), {
          email: people.editor.email,
          role: "viewer",
        }),
      ).toEqual({ ok: false, code: "already_member" });
    });
    it("email matching is case-insensitive", async () => {
      const { actor } = await orgWithAllRoles();
      const u = await createTestUser(db);
      await inviteMember(deps, actor("admin"), {
        email: u.email.toUpperCase(),
        role: "viewer",
      });
      expect((await acceptInvitation(deps, u, tokenFrom(sent[0]!.text))).ok).toBe(true);
    });
    it("a removed member can be re-invited and regain access", async () => {
      const { people, actor } = await orgWithAllRoles();
      await removeMember(deps, actor("admin"), people.viewer.id);
      await inviteMember(deps, actor("admin"), {
        email: people.viewer.email,
        role: "editor",
      });
      expect(
        (await acceptInvitation(deps, people.viewer, tokenFrom(sent[0]!.text))).ok,
      ).toBe(true);
      expect(
        (await getMember(db, actor("owner").organizationId, people.viewer.id))?.role,
      ).toBe("editor");
    });
    it("a failing mail transport does not lose the invitation", async () => {
      const { actor } = await orgWithAllRoles();
      deps = {
        ...deps,
        sendEmail: async () => {
          throw new Error("down");
        },
      };
      const result = await inviteMember(deps, actor("admin"), {
        email: "later@example.com",
        role: "viewer",
      });
      expect(result.ok).toBe(true);
      const pending = await listOrgInvitations(deps, actor("admin"));
      expect(
        pending.ok && pending.invitations.some((i) => i.email === "later@example.com"),
      ).toBe(true);
    });
  });

  describe("tenant isolation (cross-tenant / IDOR)", () => {
    it("an admin of org A cannot see, change or remove members of org B, even by user id", async () => {
      reset();
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const actorA = actorFor(ownerA.id, orgA.id, "owner");

      expect(await changeMemberRole(deps, actorA, ownerB.id, "viewer")).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await removeMember(deps, actorA, ownerB.id)).toEqual({
        ok: false,
        code: "not_found",
      });
      expect((await getMember(db, asOrganizationId(orgB.id), ownerB.id))?.role).toBe(
        "owner",
      );

      const visible = await listOrgMembers(deps, actorA);
      expect(visible.map((m) => m.userId)).toEqual([ownerA.id]);
    });
    it("invitations and audit logs never leak across organizations", async () => {
      reset();
      const { ownerA, ownerB, orgA, orgB } = await createTwoTenants(db);
      const inviteB = await inviteMember(deps, actorFor(ownerB.id, orgB.id, "owner"), {
        email: "secret-b@example.com",
        role: "viewer",
      });
      if (!inviteB.ok) throw new Error("invite failed");
      const actorA = actorFor(ownerA.id, orgA.id, "owner");

      const pendingA = await listOrgInvitations(deps, actorA);
      expect(pendingA.ok && pendingA.invitations).toEqual([]);
      expect(await revokeInvitation(deps, actorA, inviteB.invitationId)).toEqual({
        ok: false,
        code: "not_found",
      });

      const auditA = await listOrgAudit(deps, actorA);
      expect(
        auditA.ok && auditA.entries.every((e) => e.organizationId === orgA.id),
      ).toBe(true);
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, orgB.id));
      expect(rows.length).toBeGreaterThan(0); // B's trail exists, A just cannot see it
    });
    it("a member of both orgs gets only the role they hold in each", async () => {
      reset();
      const { ownerA, orgA, orgB } = await createTwoTenants(db);
      await addTestMember(db, orgB.id, ownerA.id, "viewer");
      const asViewerInB = actorFor(ownerA.id, orgB.id, "viewer");
      expect(
        await inviteMember(deps, asViewerInB, {
          email: "z@example.com",
          role: "viewer",
        }),
      ).toEqual({ ok: false, code: "forbidden" });
      expect(
        (
          await inviteMember(deps, actorFor(ownerA.id, orgA.id, "owner"), {
            email: "z@example.com",
            role: "viewer",
          })
        ).ok,
      ).toBe(true);
    });
  });
});
