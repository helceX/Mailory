import { NextResponse } from "next/server";
import { z } from "zod";
import { suppressionAddSchema } from "@mailory/validation";
import { apiError, parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps, queryObject } from "@/lib/audience/deps";
import {
  getSuppressions,
  liftSuppression,
  suppressEmails,
} from "@/lib/audience/service";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const query = querySchema.safeParse(queryObject(request.url));
    if (!query.success) return apiError(400, "validation_error", "Geçersiz sorgu.");
    const result = await getSuppressions(audienceDeps(), actor, query.data);
    return result.ok
      ? NextResponse.json({ suppressions: result.rows, total: result.total })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, suppressionAddSchema);
    if ("response" in parsed) return parsed.response;
    const result = await suppressEmails(audienceDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json(
          { added: result.added, alreadyPresent: result.alreadyPresent },
          { status: 201 },
        )
      : serviceFailure(result);
  });
}

export function DELETE(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const email = z
      .string()
      .max(254)
      .safeParse(new URL(request.url).searchParams.get("email"));
    if (!email.success) return apiError(400, "validation_error", "E-posta gerekli.");
    const result = await liftSuppression(audienceDeps(), actor, email.data);
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
