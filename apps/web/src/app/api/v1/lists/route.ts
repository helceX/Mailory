import { serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { listDto } from "@/lib/api-v1-dto";
import { audienceDeps } from "@/lib/audience/deps";
import { getLists } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withApiKey(request, "read", async ({ actor }) => {
    const r = await getLists(audienceDeps(), actor);
    return r.ok
      ? apiJson({ data: r.lists.map((l) => listDto(l as never)) })
      : serviceFailure(r);
  });
}
