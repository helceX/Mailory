import {
  SESv2Client,
  SendEmailCommand,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";

export type OutgoingEmail = {
  from: { name: string; email: string };
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  /** Extra headers (List-Unsubscribe, …). Values are validated: no CR/LF. */
  headers?: Record<string, string>;
  /** SES message tags, echoed back in event notifications. */
  tags?: Record<string, string>;
};

export type SendOutcome =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; code: string; message: string };

export interface EmailTransport {
  readonly name: string;
  send(message: OutgoingEmail): Promise<SendOutcome>;
}

const CRLF = /[\r\n\u2028\u2029]/;
export class HeaderInjectionError extends Error {}

/** Header injection is the classic bug in mailers; every user-influenced header value passes through here. */
export function assertHeaderSafe(label: string, value: string) {
  if (CRLF.test(value) || value.includes("\0"))
    throw new HeaderInjectionError(`${label} contains a line break`);
  return value;
}

/** `Name <email>` with the display name quoted, or RFC 2047 encoded when it is not plain ASCII. */
export function formatAddress(name: string, email: string): string {
  assertHeaderSafe("from name", name);
  assertHeaderSafe("from email", email);
  const clean = name.trim();
  if (!clean) return email;
  if (/^[\x20-\x7e]+$/.test(clean))
    return `"${clean.replace(/["\\]/g, "\\$&")}" <${email}>`;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?= <${email}>`;
}

/** Records what would be sent; used in development and by tests. */
export class ConsoleTransport implements EmailTransport {
  readonly name = "console";
  readonly sent: OutgoingEmail[] = [];
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(message: OutgoingEmail): Promise<SendOutcome> {
    assertHeaderSafe("subject", message.subject);
    this.sent.push(message);
    this.log(`[email] to=${message.to} subject="${message.subject}"`);
    return { ok: true, messageId: `console-${this.sent.length}-${Date.now()}` };
  }
}

const RETRYABLE = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalFailure",
  "InternalServerError",
  "RequestTimeout",
  "RequestTimeoutException",
  "TimeoutError",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
]);

/** Throttling, 5xx and network faults retry; rejections (bad address, unverified identity, suspension) never do. */
export function classifySesError(error: unknown): {
  retryable: boolean;
  code: string;
  message: string;
} {
  const e = error as {
    name?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = e?.name ?? e?.code ?? "Error";
  const status = e?.$metadata?.httpStatusCode;
  const retryable =
    RETRYABLE.has(code) ||
    (e?.code ? RETRYABLE.has(e.code) : false) ||
    (status !== undefined && status >= 500);
  return { retryable, code, message: (e?.message ?? String(error)).slice(0, 300) };
}

export class SesTransport implements EmailTransport {
  readonly name = "ses";
  private readonly client: Pick<SESv2Client, "send">;
  constructor(
    private readonly options: { region: string; configurationSet?: string },
    client?: Pick<SESv2Client, "send">,
    clientConfig: SESv2ClientConfig = {},
  ) {
    this.client =
      client ?? new SESv2Client({ region: options.region, ...clientConfig });
  }

  async send(message: OutgoingEmail): Promise<SendOutcome> {
    let from: string;
    const headers: { Name: string; Value: string }[] = [];
    try {
      from = formatAddress(message.from.name, message.from.email);
      assertHeaderSafe("to", message.to);
      assertHeaderSafe("subject", message.subject);
      if (message.replyTo) assertHeaderSafe("reply-to", message.replyTo);
      for (const [name, value] of Object.entries(message.headers ?? {})) {
        if (!/^[A-Za-z0-9-]+$/.test(name))
          throw new HeaderInjectionError(`invalid header name ${name}`);
        headers.push({ Name: name, Value: assertHeaderSafe(name, value) });
      }
    } catch (error) {
      // Never retried: the message itself is malformed.
      return {
        ok: false,
        retryable: false,
        code: "invalid_message",
        message: (error as Error).message,
      };
    }
    try {
      const out = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [message.to] },
          ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
          ConfigurationSetName: this.options.configurationSet,
          EmailTags: Object.entries(message.tags ?? {}).map(([Name, Value]) => ({
            Name,
            Value,
          })),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: message.html, Charset: "UTF-8" },
                Text: { Data: message.text, Charset: "UTF-8" },
              },
              Headers: headers.length ? headers : undefined,
            },
          },
        }),
      );
      if (!out.MessageId)
        return {
          ok: false,
          retryable: true,
          code: "no_message_id",
          message: "SES returned no MessageId",
        };
      return { ok: true, messageId: out.MessageId };
    } catch (error) {
      return { ok: false, ...classifySesError(error) };
    }
  }
}
