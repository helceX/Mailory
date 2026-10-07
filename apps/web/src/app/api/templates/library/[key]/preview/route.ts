import { CONTACT_MERGE_FIELDS, logoSrcFor } from "@mailory/core";
import { buildMergeValues, findLibraryTemplate, renderEmail } from "@mailory/email";
import { apiError, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { loadBrandKit } from "@/lib/templates/service";
import { authorize } from "@/lib/org/service";

export const dynamic = "force-dynamic";

/** HTML of a library template in the caller's brand, for gallery thumbnails inside a sandboxed iframe. */
export function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  return withActor(request, { write: false }, async ({ actor }) => {
    if (!authorize(actor, "templates:read"))
      return apiError(403, "forbidden", "Bu işlem için yetkiniz yok.");
    const { key } = await params;
    const template = findLibraryTemplate(key);
    if (!template) return apiError(404, "not_found", "Şablon bulunamadı.");
    const deps = templateDeps();
    const brand = await loadBrandKit(deps, actor);
    const sample = Object.fromEntries(
      CONTACT_MERGE_FIELDS.map((f) => [f.key, f.sample]),
    );
    const values = buildMergeValues(
      {
        firstName: sample.first_name,
        lastName: sample.last_name,
        email: sample.email,
        company: sample.company,
      },
      {
        unsubscribeUrl: `${deps.appUrl}/unsubscribe/preview`,
        viewInBrowserUrl: `${deps.appUrl}/view/preview`,
        orgName: "Örnek Organizasyon",
      },
    );
    const { html } = renderEmail(template.build(brand), {
      values,
      appUrl: deps.appUrl,
      brandLogoUrl: logoSrcFor(brand) || undefined,
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Defense in depth: even if sanitizing were bypassed, nothing here can execute.
        "Content-Security-Policy":
          "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
