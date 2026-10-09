import "server-only";
import { enqueueEmail, markEmailDelivered, markEmailFailed } from "@mailory/db";
import { getEnv } from "@mailory/config";
import { getDb } from "../db";
import type { CampaignDeps } from "./service";

/**
 * Test emails are recorded in the outbox (text body; the HTML is rendered but only SES delivery in Phase 8 can carry
 * it). With EMAIL_PROVIDER=console the message is logged and marked delivered, like system email.
 */
export function campaignDeps(): CampaignDeps {
  const env = getEnv();
  const { db } = getDb();
  return {
    db,
    appUrl: env.APP_URL.replace(/\/$/, ""),
    async sendTest(message) {
      const id = await enqueueEmail(db, {
        toEmail: message.to,
        subject: message.subject,
        bodyText: message.text,
        kind: "campaign_test",
      });
      if (env.EMAIL_PROVIDER === "console") {
        console.log(
          `[email] campaign test to=${message.to} subject="${message.subject}"`,
        );
        await markEmailDelivered(db, id, "console");
        return;
      }
      const reason = `EMAIL_PROVIDER="${env.EMAIL_PROVIDER}" is not implemented yet`;
      await markEmailFailed(db, id, reason);
      throw new Error(reason);
    },
  };
}
