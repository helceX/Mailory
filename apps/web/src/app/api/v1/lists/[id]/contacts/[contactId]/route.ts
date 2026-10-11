import { z } from "zod";
import { serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { audienceDeps } from "@/lib/audience/deps";
import { bulkAction } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

/** Removes one contact from a list (the contact itself is untouched). */
export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  return withApiKey(request, "write", async ({ actor }) => {
    const { id, contactId } = await params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(contactId).success)
      return serviceFailure({ code: "not_found" });
    const r = await bulkAction(audienceDeps(), actor, {
      action: "remove_from_list",
      listId: id,
      ids: [contactId],
    });
    return r.ok ? apiJson({ removed: r.affected }) : serviceFailure(r);
  });
}
