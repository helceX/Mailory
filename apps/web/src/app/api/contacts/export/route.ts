import { contactFilterSchema } from "@mailory/validation";
import { apiError, limit, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps, queryObject } from "@/lib/audience/deps";
import { exportContacts } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

/** GET (not POST) so the browser can download it directly; it is read-only but audited and rate-limited. */
export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const limited = await limit(`export:${actor.organizationId}`, 10, 3600);
    if (limited) return limited;
    const filter = contactFilterSchema.safeParse(queryObject(request.url));
    if (!filter.success) return apiError(400, "validation_error", "Geçersiz filtre.");
    const result = await exportContacts(audienceDeps(), actor, filter.data);
    if (!result.ok) return serviceFailure(result);

    const encoder = new TextEncoder();
    const iterator = result.lines[Symbol.asyncIterator]();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mailory-contacts-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
