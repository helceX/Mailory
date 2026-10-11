import "server-only";
import { enqueueEmail, markEmailDelivered, markEmailFailed } from "@mailory/db";
import { getEnv } from "@mailory/config";
import { getDb } from "./db";
import type { SendEmail } from "./auth/service";

/**
 * System email (verification, reset). Every message is recorded in email_outbox first.
 * `console` marks it delivered immediately (dev inbox); `ses` arrives in Phase 8 and until
 * then records a failure rather than pretending — callers treat sending as best-effort.
 */
export const sendSystemEmail: SendEmail = async (message) => {
  const env = getEnv();
  const { db } = getDb();
  const id = await enqueueEmail(db, {
    toEmail: message.to,
    subject: message.subject,
    bodyText: message.text,
    kind: message.kind,
  });
  if (env.EMAIL_PROVIDER === "console") {
    console.log(
      `[email] to=${message.to} kind=${message.kind} subject="${message.subject}"`,
    );
    await markEmailDelivered(db, id, "console");
    return;
  }
  const reason = `EMAIL_PROVIDER="${env.EMAIL_PROVIDER}" is not implemented yet`;
  await markEmailFailed(db, id, reason);
  throw new Error(reason);
};
