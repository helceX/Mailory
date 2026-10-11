import { NextResponse } from "next/server";
import { contactInputSchema } from "@mailory/validation";
import { apiError, parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps, listQuerySchema, queryObject } from "@/lib/audience/deps";
import { createContactFor, searchContacts } from "@/lib/audience/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const query = listQuerySchema.safeParse(queryObject(request.url));
    if (!query.success) return apiError(400, "validation_error", "Geçersiz sorgu.");
    const { cursor, limit, ...filter } = query.data;
    const result = await searchContacts(audienceDeps(), actor, {
      filter,
      cursor,
      limit,
    });
    return result.ok
      ? NextResponse.json({
          contacts: result.rows,
          nextCursor: result.nextCursor,
          total: result.total,
        })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, contactInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createContactFor(audienceDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.contact.id }, { status: 201 })
      : serviceFailure(result);
  });
}
