import { createVerify } from "node:crypto";

export type SnsMessage = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
};

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Only certificates served by SNS itself are trusted; anything else would let an attacker sign their own messages. */
export function isTrustedCertUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      CERT_HOST.test(u.hostname) &&
      u.port === "" &&
      u.username === "" &&
      u.pathname.endsWith(".pem")
    );
  } catch {
    return false;
  }
}

/** Only AWS-hosted confirmation endpoints may be called back (SSRF guard). */
export function isTrustedSubscribeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && CERT_HOST.test(u.hostname) && u.port === "";
  } catch {
    return false;
  }
}

/** The exact string SNS signs (field order and presence are part of the protocol). */
export function canonicalString(m: SnsMessage): string {
  const fields: [string, string | undefined][] =
    m.Type === "Notification"
      ? [
          ["Message", m.Message],
          ["MessageId", m.MessageId],
          ["Subject", m.Subject],
          ["Timestamp", m.Timestamp],
          ["TopicArn", m.TopicArn],
          ["Type", m.Type],
        ]
      : [
          ["Message", m.Message],
          ["MessageId", m.MessageId],
          ["SubscribeURL", m.SubscribeURL],
          ["Timestamp", m.Timestamp],
          ["Token", m.Token],
          ["TopicArn", m.TopicArn],
          ["Type", m.Type],
        ];
  return fields
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}\n${v}\n`)
    .join("");
}

export function parseSnsMessage(body: string): SnsMessage | null {
  try {
    const m = JSON.parse(body) as Partial<SnsMessage>;
    const need = [
      "Type",
      "MessageId",
      "TopicArn",
      "Message",
      "Timestamp",
      "Signature",
      "SignatureVersion",
      "SigningCertURL",
    ] as const;
    if (!need.every((k) => typeof m[k] === "string")) return null;
    if (
      !["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(
        m.Type!,
      )
    )
      return null;
    return m as SnsMessage;
  } catch {
    return null;
  }
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifySnsMessage(
  m: SnsMessage,
  options: {
    /** Returns the PEM of the signing certificate (or public key). */
    fetchCert: (url: string) => Promise<string>;
    /** Only messages from this topic are accepted. */
    allowedTopicArn: string;
  },
): Promise<VerifyResult> {
  if (m.TopicArn !== options.allowedTopicArn)
    return { ok: false, reason: "topic_mismatch" };
  if (m.SignatureVersion !== "1" && m.SignatureVersion !== "2")
    return { ok: false, reason: "signature_version" };
  if (!isTrustedCertUrl(m.SigningCertURL))
    return { ok: false, reason: "untrusted_cert_url" };
  let pem: string;
  try {
    pem = await options.fetchCert(m.SigningCertURL);
  } catch {
    return { ok: false, reason: "cert_unavailable" };
  }
  try {
    const verifier = createVerify(
      m.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1",
    );
    verifier.update(canonicalString(m), "utf8");
    return verifier.verify(pem, m.Signature, "base64")
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}
