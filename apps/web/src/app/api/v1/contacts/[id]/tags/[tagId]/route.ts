import { z } from "zod";
import { serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { audienceDeps } from "@/lib/audience/deps";
import { bulkAction } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; tagId: string }> };

async function tag(
  request: Request,
  { params }: Ctx,
  action: "add_tag" | "remove_tag",
) {
  return withApiKey(request, "write", async ({ actor }) => {
    const { id, tagId } = await params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(tagId).success)
      return serviceFailure({ code: "not_found" });
    const ids = [id];
    const r = await bulkAction(
      audienceDeps(),
      actor,
      action === "add_tag" ? { action, tagId, ids } : { action, tagId, ids },
    );
    return r.ok ? apiJson({ affected: r.affected }) : serviceFailure(r);
  });
}

/** Adds the tag to the contact (idempotent). */
export const PUT = (request: Request, ctx: Ctx) => tag(request, ctx, "add_tag");
/** Removes the tag from the contact. */
export const DELETE = (request: Request, ctx: Ctx) => tag(request, ctx, "remove_tag");
