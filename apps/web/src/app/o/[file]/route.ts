import { TRANSPARENT_GIF, handleOpen } from "@mailory/sending";
import { clientIp } from "@/lib/api";
import { sendingDeps } from "@/lib/sending-deps";

export const dynamic = "force-dynamic";

/** Open pixel. Always answers with the same GIF so it never reveals whether a token was genuine. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const token = file.replace(/\.gif$/i, "");
  await handleOpen(sendingDeps(), token, {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request),
    purpose: request.headers.get("sec-purpose") ?? request.headers.get("purpose"),
  });
  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      "Cache-Control": "no-store, private, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
