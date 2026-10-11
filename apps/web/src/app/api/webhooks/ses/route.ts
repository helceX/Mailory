import { NextResponse } from "next/server";
import { getEnv } from "@mailory/config";
import {
  isTrustedSubscribeUrl,
  parseSnsMessage,
  verifySnsMessage,
} from "@mailory/email";
import { processSesEvent } from "@mailory/sending";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
const MAX_BODY = 256 * 1024;

const certCache = new Map<string, string>();
async function fetchCert(url: string): Promise<string> {
  const hit = certCache.get(url);
  if (hit) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`cert fetch ${res.status}`);
  const pem = await res.text();
  if (certCache.size > 20) certCache.clear();
  certCache.set(url, pem);
  return pem;
}

/**
 * SES → SNS → here. Authenticated solely by the SNS signature (verified against an AWS-hosted certificate) and the
 * configured topic ARN; there is no session or cookie, so nothing else can be trusted. Non-2xx makes SNS redeliver.
 */
export async function POST(request: Request) {
  const env = getEnv();
  if (env.EMAIL_PROVIDER !== "ses" || !env.SES_SNS_TOPIC_ARN)
    return new NextResponse("Not found", { status: 404 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return new NextResponse("Too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY) return new NextResponse("Too large", { status: 413 });

  const message = parseSnsMessage(body);
  if (!message) return new NextResponse("Bad request", { status: 400 });
  const verdict = await verifySnsMessage(message, {
    fetchCert,
    allowedTopicArn: env.SES_SNS_TOPIC_ARN,
  });
  if (!verdict.ok) {
    console.warn(`[ses-webhook] rejected message: ${verdict.reason}`);
    // A cert we could not fetch is our problem (retry); everything else is a forgery or misconfiguration.
    return new NextResponse("Rejected", {
      status: verdict.reason === "cert_unavailable" ? 503 : 403,
    });
  }

  if (message.Type === "SubscriptionConfirmation") {
    if (!message.SubscribeURL || !isTrustedSubscribeUrl(message.SubscribeURL))
      return new NextResponse("Bad request", { status: 400 });
    const res = await fetch(message.SubscribeURL, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return new NextResponse(res?.ok ? "Confirmed" : "Failed", {
      status: res?.ok ? 200 : 502,
    });
  }
  if (message.Type !== "Notification") return new NextResponse("OK");

  const result = await processSesEvent(
    { db: getDb().db },
    message.MessageId,
    message.Message,
    new Date(message.Timestamp),
  );
  if (result === "retry_later") return new NextResponse("Retry", { status: 503 });
  return NextResponse.json({ result });
}
