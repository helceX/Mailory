import { suppressionAddSchema } from "@mailory/validation";
import { apiError, parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { audienceDeps } from "@/lib/audience/deps";
import { getSuppressions, suppressEmails } from "@/lib/audience/service";

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

/** Lists suppressed addresses (newest first). `q` filters by address; `limit` ≤ 200, `offset` pages. */
export function GET(request: Request) {
  return withApiKey(request, "read", async ({ actor }) => {
    const url = new URL(request.url);
    const n = (k: string) =>
      url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined;
    const limit = n("limit");
    const offset = n("offset");
    if (
      (limit !== undefined &&
        !(Number.isInteger(limit) && limit >= 1 && limit <= 200)) ||
      (offset !== undefined && !(Number.isInteger(offset) && offset >= 0))
    )
      return apiError(400, "validation_error", "Geçersiz sorgu.");
    const r = await getSuppressions(audienceDeps(), actor, {
      q: url.searchParams.get("q")?.slice(0, 100) || undefined,
      limit,
      offset,
    });
    return r.ok
      ? apiJson({
          data: r.rows.map((s) => ({
            email: s.email,
            reason: s.reason,
            createdAt: s.createdAt.toISOString(),
          })),
          total: r.total,
        })
      : serviceFailure(r);
  });
}
