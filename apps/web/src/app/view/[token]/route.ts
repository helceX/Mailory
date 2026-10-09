import { renderForView } from "@mailory/sending";
import { getEnv } from "@mailory/config";
import { clientIp, limit } from "@/lib/api";
import { sendingDeps } from "@/lib/sending-deps";

export const dynamic = "force-dynamic";

/** "View in browser": the recipient's own personalised email, served with a CSP that forbids any script. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await limit(`view:${clientIp(request)}`, 120, 60);
  if (limited) return limited;
  const { token } = await params;
  const page = await renderForView(
    { ...sendingDeps(), appUrl: getEnv().APP_URL.replace(/\/$/, "") },
    token,
  );
  if (!page) return new Response("E-posta bulunamadı.", { status: 404 });
  return new Response(page.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
