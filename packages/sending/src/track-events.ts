import { readClickToken, readOpenToken, readViewToken } from "@mailory/core";
import {
  asOrganizationId,
  getCampaign,
  getContactForSend,
  getLinkUrl,
  getOrganization,
  getRecipient,
  recipientSentAt,
  recordTracking,
  type CampaignSnapshot,
  type Database,
} from "@mailory/db";
import { renderMessage } from "./message";
import { classifyDevice, hashIp, looksLikeBot } from "./tracking";

export type TrackDeps = { db: Database; secret: string; now?: () => Date };
export type TrackRequest = {
  userAgent?: string | null;
  ip?: string | null;
  /** Sec-Purpose / Purpose header (browser or proxy prefetch). */
  purpose?: string | null;
};

const clock = (d: TrackDeps) => (d.now ?? (() => new Date()))();

async function record(
  deps: TrackDeps,
  t: {
    organizationId: string;
    campaignId: string;
    recipientId: string;
    linkId?: string;
  },
  type: "open" | "click",
  req: TrackRequest,
) {
  const org = asOrganizationId(t.organizationId);
  const now = clock(deps);
  const info = await recipientSentAt(deps.db, org, t.recipientId);
  // A token whose ids do not match the stored recipient/campaign records nothing.
  if (!info || info.campaignId !== t.campaignId) return false;
  const isBot = looksLikeBot({
    ua: req.userAgent,
    purpose: req.purpose,
    type,
    msSinceSent: info.sentAt ? now.getTime() - info.sentAt.getTime() : null,
  });
  return recordTracking(deps.db, org, {
    campaignId: t.campaignId,
    recipientId: t.recipientId,
    linkId: t.linkId ?? null,
    type,
    device: classifyDevice(req.userAgent),
    ipHash: hashIp(deps.secret, req.ip, now),
    isBot,
    at: now,
  });
}

/** Records an open if the token is valid. Always "succeeds": the pixel must not reveal whether a token was genuine. */
export async function handleOpen(deps: TrackDeps, token: string, req: TrackRequest) {
  const t = readOpenToken(deps.secret, token);
  if (!t) return;
  try {
    await record(deps, t, "open", req);
  } catch (error) {
    console.error("[tracking] open failed", error);
  }
}

/**
 * Resolves a click token to its destination (from our own table — the token carries only ids, so it can never be
 * turned into an open redirect) and records the click. A recording failure never blocks the redirect.
 */
export async function handleClick(deps: TrackDeps, token: string, req: TrackRequest) {
  const t = readClickToken(deps.secret, token);
  if (!t) return null;
  const url = await getLinkUrl(
    deps.db,
    asOrganizationId(t.organizationId),
    t.campaignId,
    t.linkId,
  );
  if (!url) return null;
  try {
    await record(deps, t, "click", req);
  } catch (error) {
    console.error("[tracking] click failed", error);
  }
  return { url };
}

/** The "view in browser" page: the same email the recipient got (personalised), untracked. */
export async function renderForView(
  deps: TrackDeps & { appUrl: string },
  token: string,
) {
  const t = readViewToken(deps.secret, token);
  if (!t) return null;
  const org = asOrganizationId(t.organizationId);
  const recipient = await getRecipient(deps.db, org, t.recipientId);
  if (!recipient) return null;
  const campaign = await getCampaign(deps.db, org, recipient.campaignId);
  const snapshot = campaign?.snapshot as CampaignSnapshot | null | undefined;
  if (!campaign || !snapshot) return null;
  const [contact, organization] = await Promise.all([
    recipient.contactId ? getContactForSend(deps.db, org, recipient.contactId) : null,
    getOrganization(deps.db, org),
  ]);
  const message = await renderMessage({
    campaign,
    snapshot,
    recipient: { id: recipient.id, email: recipient.email },
    contact,
    orgName: organization?.name ?? "",
    appUrl: deps.appUrl,
    secret: deps.secret,
  });
  return { html: message.html, subject: message.subject };
}
