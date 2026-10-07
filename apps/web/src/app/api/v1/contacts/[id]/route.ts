import { z } from "zod";
import { serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { contactDto } from "@/lib/api-v1-dto";
import { audienceDeps } from "@/lib/audience/deps";
import { getContactDetail } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(request, "read", async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await getContactDetail(audienceDeps(), actor, id);
    return r.ok ? apiJson(contactDto(r.contact as never)) : serviceFailure(r);
  });
}
