import { z } from "zod";
import { getAssetPublic } from "@mailory/db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Public image endpoint: emails embed these URLs, so no session is possible. The unguessable id is the
 * credential. The response can never be interpreted as anything but an image or run script.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  const asset = await getAssetPublic(getDb().db, id);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${asset.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
