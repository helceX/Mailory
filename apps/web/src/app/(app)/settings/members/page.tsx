import { can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import { InviteForm } from "@/components/members/invite-form";
import { MembersTable } from "@/components/members/members-table";
import { PendingInvitations } from "@/components/members/pending-invitations";
import { getOrgContext, orgDeps } from "@/lib/org/context";
import { listOrgInvitations, listOrgMembers } from "@/lib/org/service";

export const metadata = { title: "Üyeler" };

export default async function MembersPage() {
  const context = (await getOrgContext())!;
  const actor = context.actor!;
  const deps = orgDeps();
  const canManage = can(actor.role, "org:manage_members");

  const members = await listOrgMembers(deps, actor);
  const invitations = canManage ? await listOrgInvitations(deps, actor) : null;

  return (
    <>
      <PageHeader
        title="Üyeler"
        description={
          canManage
            ? "Ekibinizi davet edin ve rollerini yönetin."
            : "Bu organizasyondaki ekip üyeleri."
        }
      />
      {canManage ? <InviteForm actorRole={actor.role} /> : null}
      <MembersTable
        members={members.map((m) => ({
          userId: m.userId,
          name: `${m.firstName} ${m.lastName}`,
          email: m.email,
          role: m.role,
        }))}
        currentUserId={actor.userId}
        actorRole={actor.role}
      />
      {invitations?.ok ? (
        <PendingInvitations
          invitations={invitations.invitations.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            expiresAt: i.expiresAt.toISOString(),
          }))}
        />
      ) : null}
    </>
  );
}
