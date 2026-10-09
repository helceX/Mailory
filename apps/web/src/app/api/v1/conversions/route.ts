import { conversionSchema } from "@mailory/validation";
import { parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { recordConversionFor } from "@/lib/conversions/service";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Report an outcome (purchase, registration, …). Mailory attributes it to the campaign the person last clicked
 * (else last received) within 30 days. Send `externalId` (e.g. your order id) so retries never double count.
 */
export function POST(request: Request) {
  return withApiKey(request, "write", async ({ actor }) => {
    const parsed = await parseJson(request, conversionSchema);
    if ("response" in parsed) return parsed.response;
    const r = await recordConversionFor({ db: getDb().db }, actor, parsed.data);
    if (!r.ok) return serviceFailure(r);
    return apiJson(
      {
        id: r.id,
        campaignId: r.campaignId,
        attribution: r.attribution,
        duplicate: !r.created,
      },
      r.created ? 201 : 200,
    );
  });
}
