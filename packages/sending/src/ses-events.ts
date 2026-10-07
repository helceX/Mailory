import {
  applyRecipientEvent,
  asOrganizationId,
  findRecipientByMessageId,
  getCampaign,
  haltCampaign,
  markRecipientFailed,
  recordAudit,
  recordEmailEvent,
  suppressForEvent,
  type Database,
} from "@mailory/db";
import { evaluateHealth } from "./engine";

export type SesEventResult =
  | "processed"
  | "duplicate"
  /** Unknown message that is too fresh to judge: ask SNS to redeliver (the send may not be committed yet). */
  | "retry_later"
  | "unknown_message"
  | "ignored";

/** An event can outrun the transaction that stores the message id; younger than this we ask for redelivery. */
export const UNKNOWN_GRACE_MS = 5 * 60_000;

type SesEvent = {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string };
  bounce?: { bounceType?: string; bounceSubType?: string; timestamp?: string };
  complaint?: { timestamp?: string; complaintFeedbackType?: string };
  delivery?: { timestamp?: string };
  reject?: { reason?: string };
};

export function parseSesEvent(message: string): SesEvent | null {
  try {
    const e = JSON.parse(message) as SesEvent;
    return e && typeof e === "object" ? e : null;
  } catch {
    return null;
  }
}

/**
 * Applies one SES notification (already authenticated by SNS signature verification). `eventId` is the SNS MessageId:
 * redelivered notifications are recorded once and change nothing the second time.
 */
export async function processSesEvent(
  deps: { db: Database; now?: () => Date },
  eventId: string,
  message: string,
  receivedAt: Date,
): Promise<SesEventResult> {
  const now = (deps.now ?? (() => new Date()))();
  const event = parseSesEvent(message);
  const kind = (event?.eventType ?? event?.notificationType ?? "").toLowerCase();
  const messageId = event?.mail?.messageId;
  if (!event || !messageId || !kind) return "ignored";

  const occurredAt = new Date(
    event.bounce?.timestamp ??
      event.complaint?.timestamp ??
      event.delivery?.timestamp ??
      receivedAt,
  );
  const at = Number.isNaN(occurredAt.getTime()) ? receivedAt : occurredAt;

  const recipient = await findRecipientByMessageId(deps.db, messageId);
  if (!recipient) {
    return now.getTime() - at.getTime() < UNKNOWN_GRACE_MS
      ? "retry_later"
      : "unknown_message";
  }
  const org = asOrganizationId(recipient.organizationId);

  const fresh = await recordEmailEvent(deps.db, {
    organizationId: org,
    providerEventId: eventId,
    type: kind,
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    payload: event,
    occurredAt: at,
  });
  if (!fresh) return "duplicate";

  let halt = false;
  switch (kind) {
    case "delivery":
      await applyRecipientEvent(deps.db, org, recipient.id, "delivered", at);
      break;
    case "bounce":
      // Transient bounces are retried by the receiving side; only permanent ones end the address.
      if (event.bounce?.bounceType === "Permanent") {
        await applyRecipientEvent(deps.db, org, recipient.id, "bounced", at);
        await suppressForEvent(deps.db, org, recipient.email, "hard_bounce");
        halt = true;
      }
      break;
    case "complaint":
      await applyRecipientEvent(deps.db, org, recipient.id, "complained", at);
      await suppressForEvent(deps.db, org, recipient.email, "complaint");
      halt = true;
      break;
    case "reject":
      if (recipient.status === "sent")
        await markRecipientFailed(
          deps.db,
          org,
          recipient.id,
          "failed",
          `rejected: ${event.reject?.reason ?? "unknown"}`,
        );
      break;
    default:
      return "processed"; // send, open, click, delivery delay …: stored, no state change yet
  }

  if (halt) {
    const campaign = await getCampaign(deps.db, org, recipient.campaignId);
    if (campaign?.status === "sending") {
      const verdict = await evaluateHealth(deps, campaign);
      if (verdict) {
        await haltCampaign(deps.db, org, campaign.id, "paused", verdict, now);
        await recordAudit(deps.db, {
          organizationId: org,
          userId: null,
          action: "campaign.auto_paused",
          entityType: "campaign",
          entityId: campaign.id,
          metadata: { reason: verdict },
        });
      }
    }
  }
  return "processed";
}
