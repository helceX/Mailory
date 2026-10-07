import { contactInputSchema } from "@mailory/validation";
import { apiError, parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { contactDto } from "@/lib/api-v1-dto";
import { audienceDeps, listQuerySchema, queryObject } from "@/lib/audience/deps";
import { createContactFor, searchContacts } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withApiKey(request, "read", async ({ actor }) => {
    const query = listQuerySchema.safeParse(queryObject(request.url));
    if (!query.success) return apiError(400, "validation_error", "Geçersiz sorgu.");
    const { cursor, limit, ...filter } = query.data;
    const r = await searchContacts(audienceDeps(), actor, { filter, cursor, limit });
    return r.ok
      ? apiJson({
          data: r.rows.map((c) => contactDto(c as never)),
          nextCursor: r.nextCursor,
        })
      : serviceFailure(r);
  });
}

export function POST(request: Request) {
  return withApiKey(request, "write", async ({ actor }) => {
    const parsed = await parseJson(request, contactInputSchema);
    if ("response" in parsed) return parsed.response;
    // Contacts created through the API are marked as such unless the caller names a source; a "granted" consent
    // without an explicit consent source records the API as the source (the integrator is responsible for the proof).
    const input = {
      ...parsed.data,
      source: parsed.data.source ?? "api",
      consentSource:
        parsed.data.consentSource ??
        (parsed.data.consentStatus === "granted" ? "api" : undefined),
    };
    const r = await createContactFor(audienceDeps(), actor, input);
    return r.ok ? apiJson(contactDto(r.contact as never), 201) : serviceFailure(r);
  });
}
