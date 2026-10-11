import {
  applyMerge,
  clickToken,
  logoSrcFor,
  openToken,
  unsubscribeToken,
  viewToken,
  type BrandKit,
  type EmailDoc,
} from "@mailory/core";
import type { Campaign, CampaignSnapshot } from "@mailory/db";
import {
  applyUtm,
  applyUtmToText,
  buildMergeValues,
  renderEmail,
} from "@mailory/email";
import { injectPixel, openPixelHtml, rewriteLinks, trackableUrls } from "./tracking";

export const oneLine = (v: string) => v.replace(/[\r\n\u2028\u2029]+/g, " ");

export type MessageInput = {
  campaign: Pick<
    Campaign,
    | "id"
    | "organizationId"
    | "subject"
    | "preheader"
    | "utm"
    | "trackOpens"
    | "trackClicks"
  >;
  snapshot: CampaignSnapshot;
  recipient: { id: string; email: string };
  contact: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    company: string | null;
    position: string | null;
    city: string | null;
    sector: string | null;
    custom: unknown;
  } | null;
  orgName: string;
  appUrl: string;
  secret: string;
  /**
   * Click/open tracking for real sends. Resolves destination URLs to link ids (registering them); omitted for the
   * browser view, which is never tracked.
   */
  tracking?: { resolveLinks: (urls: string[]) => Promise<Map<string, string>> };
};

/** The single place a recipient's email is produced; the send engine and the view-in-browser page both use it. */
export async function renderMessage(input: MessageInput) {
  const { campaign, snapshot, recipient, appUrl, secret } = input;
  const doc = snapshot.doc as EmailDoc;
  const brand = snapshot.brand as BrandKit;
  const org = campaign.organizationId;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken(secret, org, recipient.id)}`;
  const viewUrl = `${appUrl}/view/${viewToken(secret, org, recipient.id)}`;
  const c = input.contact;
  const values = buildMergeValues(
    {
      firstName: c?.firstName,
      lastName: c?.lastName,
      email: c?.email ?? recipient.email,
      company: c?.company,
      position: c?.position,
      city: c?.city,
      sector: c?.sector,
      custom: (c?.custom ?? {}) as Record<string, string | number | boolean | null>,
    },
    { unsubscribeUrl, viewInBrowserUrl: viewUrl, orgName: input.orgName },
  );
  const withPreheader: EmailDoc = {
    ...doc,
    settings: {
      ...doc.settings,
      preheader: campaign.preheader || doc.settings.preheader,
    },
  };
  const rendered = renderEmail(withPreheader, {
    values,
    appUrl,
    brandLogoUrl: logoSrcFor(brand) || undefined,
    subject: campaign.subject,
  });
  const skip = [
    `${appUrl}/unsubscribe/`,
    `${appUrl}/api/unsubscribe/`,
    `${appUrl}/view/`,
    `${appUrl}/c/`,
  ];
  let html = applyUtm(rendered.html, campaign.utm, skip);
  let text = applyUtmToText(rendered.text, campaign.utm, skip);

  if (input.tracking && campaign.trackClicks) {
    const urls = trackableUrls(html, skip);
    if (urls.length > 0) {
      const ids = await input.tracking.resolveLinks(urls);
      const redirects = new Map<string, string>();
      for (const [url, linkId] of ids)
        redirects.set(
          url,
          `${appUrl}/c/${clickToken(secret, org, campaign.id, recipient.id, linkId)}`,
        );
      html = rewriteLinks(html, redirects, "html");
      text = rewriteLinks(text, redirects, "text");
    }
  }
  if (input.tracking && campaign.trackOpens)
    html = injectPixel(
      html,
      openPixelHtml(
        `${appUrl}/o/${openToken(secret, org, campaign.id, recipient.id)}.gif`,
      ),
    );

  // A contact's name must never be able to inject a header line into the subject.
  const subject = oneLine(applyMerge(campaign.subject, values, oneLine)).trim();
  return {
    subject,
    html,
    text,
    unsubscribeToken: unsubscribeToken(secret, org, recipient.id),
  };
}
