import { canAssignRole, type OrgRole } from "@mailory/core/shared";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Sahip",
  admin: "Yönetici",
  editor: "Editör",
  viewer: "Görüntüleyici",
};
export const ROLE_HINTS: Record<OrgRole, string> = {
  owner: "Faturalama ve organizasyon silme dahil her şey",
  admin: "Üyeleri, ayarları ve onayları yönetir",
  editor: "Contact, şablon ve kampanya oluşturur",
  viewer: "Yalnızca görüntüler",
};

export function assignableRoles(actorRole: OrgRole): OrgRole[] {
  return (["owner", "admin", "editor", "viewer"] as const).filter((r) =>
    canAssignRole(actorRole, r),
  );
}
