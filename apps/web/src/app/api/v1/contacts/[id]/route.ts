import { z } from "zod";
import { contactPatchSchema } from "@mailory/validation";
import { parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { contactDto } from "@/lib/api-v1-dto";
import { audienceDeps } from "@/lib/audience/deps";
import { getContactDetail, updateContactFor } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(request, "read", async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await getContactDetail(audienceDeps(), actor, id);
    return r.ok ? apiJson(contactDto(r.contact as never)) : serviceFailure(r);
  });
}

/** Partial update. Names/company/custom fields/consent; a suppressed address can never be re-subscribed this way. */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiKey(request, "write", async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, contactPatchSchema);
    if ("response" in parsed) return parsed.response;
    const patch =
      parsed.data.consentStatus === "granted" && !parsed.data.consentSource
        ? { ...parsed.data, consentSource: "api" }
        : parsed.data;
    const updated = await updateContactFor(audienceDeps(), actor, id, patch);
    if (!updated.ok) return serviceFailure(updated);
    const r = await getContactDetail(audienceDeps(), actor, id);
    return r.ok ? apiJson(contactDto(r.contact as never)) : serviceFailure(r);
  });
}
