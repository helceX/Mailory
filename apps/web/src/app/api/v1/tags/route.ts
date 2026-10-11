import { z } from "zod";
import { parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { audienceDeps } from "@/lib/audience/deps";
import { createTagFor, getTags } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

const tagSchema = z.object({
  name: z.string().trim().min(1, "Etiket adı gerekli.").max(50),
});

export function GET(request: Request) {
  return withApiKey(request, "read", async ({ actor }) => {
    const r = await getTags(audienceDeps(), actor);
    return r.ok
      ? apiJson({
          data: r.tags.map((t) => ({
            id: t.id,
            name: t.name,
            contactCount: t.contactCount,
          })),
        })
      : serviceFailure(r);
  });
}

export function POST(request: Request) {
  return withApiKey(request, "write", async ({ actor }) => {
    const parsed = await parseJson(request, tagSchema);
    if ("response" in parsed) return parsed.response;
    const r = await createTagFor(audienceDeps(), actor, parsed.data.name);
    return r.ok
      ? apiJson({ id: r.id, name: parsed.data.name }, 201)
      : serviceFailure(r);
  });
}
