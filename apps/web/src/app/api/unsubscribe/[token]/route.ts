import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@mailory/sending";
import { clientIp, limit } from "@/lib/api";
import { sendingDeps } from "@/lib/sending-deps";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click target (mail clients POST `List-Unsubscribe=One-Click` here) and the endpoint behind the
 * confirmation button. No cookies are involved, so there is no CSRF surface: the signed token is the credential.
 * GET deliberately does nothing — link scanners and prefetchers must never unsubscribe anyone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited = await limit(`unsubscribe:${clientIp(request)}`, 60, 3600);
  if (limited) return limited;
  const contentType = request.headers.get("content-type") ?? "";
  const oneClick =
    contentType.includes("application/x-www-form-urlencoded") &&
    (await request.text()).includes("List-Unsubscribe=One-Click");
  const result = await unsubscribeByToken(
    sendingDeps(),
    token,
    oneClick ? "one_click" : "link",
  );
  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false }, { status: 404 });
}

export function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return params.then(({ token }) =>
    NextResponse.redirect(
      new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url),
      303,
    ),
  );
}
