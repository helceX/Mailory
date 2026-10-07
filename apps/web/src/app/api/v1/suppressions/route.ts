import { suppressionAddSchema } from "@mailory/validation";
import { parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { audienceDeps } from "@/lib/audience/deps";
import { suppressEmails } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

/** Adds addresses that must never be mailed (e.g. unsubscribes collected by another system). */
export function POST(request: Request) {
  return withApiKey(request, "write", async ({ actor }) => {
    const parsed = await parseJson(request, suppressionAddSchema);
    if ("response" in parsed) return parsed.response;
    const r = await suppressEmails(audienceDeps(), actor, parsed.data);
    return r.ok
      ? apiJson({ added: r.added, alreadyPresent: r.alreadyPresent })
      : serviceFailure(r);
  });
}
