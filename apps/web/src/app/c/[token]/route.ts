import { handleClick } from "@mailory/sending";
import { clientIp } from "@/lib/api";
import { sendingDeps } from "@/lib/sending-deps";

export const dynamic = "force-dynamic";

/**
 * Click redirect. The destination comes from our own table, looked up by id; the token only carries ids, so this can
 * never be used as an open redirector.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await handleClick(sendingDeps(), token, {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request),
    purpose: request.headers.get("sec-purpose") ?? request.headers.get("purpose"),
  });
  if (!result) return new Response("Bağlantı bulunamadı.", { status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: result.url,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
