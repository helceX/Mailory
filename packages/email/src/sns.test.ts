import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalString,
  isTrustedCertUrl,
  isTrustedSubscribeUrl,
  parseSnsMessage,
  verifySnsMessage,
  type SnsMessage,
} from "./sns";

const TOPIC = "arn:aws:sns:eu-west-1:123456789012:mailory-ses";
const CERT_URL =
  "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signed(
  overrides: Partial<SnsMessage> = {},
  version: "1" | "2" = "2",
): SnsMessage {
  const m: SnsMessage = {
    Type: "Notification",
    MessageId: "mid-1",
    TopicArn: TOPIC,
    Message: '{"eventType":"Delivery"}',
    Timestamp: "2026-03-01T10:00:00.000Z",
    Signature: "",
    SignatureVersion: version,
    SigningCertURL: CERT_URL,
    ...overrides,
  };
  const s = createSign(version === "2" ? "RSA-SHA256" : "RSA-SHA1");
  s.update(canonicalString(m), "utf8");
  m.Signature = s.sign(privateKey, "base64");
  return m;
}
const opts = { fetchCert: async () => pem, allowedTopicArn: TOPIC };

describe("SNS verification", () => {
  it("accepts a correctly signed notification (v1 and v2)", async () => {
    expect(await verifySnsMessage(signed(), opts)).toEqual({ ok: true });
    expect(await verifySnsMessage(signed({}, "1"), opts)).toEqual({ ok: true });
    expect(await verifySnsMessage(signed({ Subject: "Hello" }), opts)).toEqual({
      ok: true,
    });
  });
  it("rejects a tampered body or subject", async () => {
    const m = signed();
    expect(
      await verifySnsMessage({ ...m, Message: '{"eventType":"Bounce"}' }, opts),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(await verifySnsMessage({ ...m, Subject: "injected" }, opts)).toMatchObject({
      ok: false,
    });
  });
  it("rejects another key, another topic and bad versions", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(
      await verifySnsMessage(signed(), { ...opts, fetchCert: async () => other }),
    ).toMatchObject({ reason: "bad_signature" });
    expect(
      await verifySnsMessage(signed({ TopicArn: "arn:aws:sns:x:1:other" }), opts),
    ).toMatchObject({ reason: "topic_mismatch" });
    expect(
      await verifySnsMessage({ ...signed(), SignatureVersion: "3" }, opts),
    ).toMatchObject({ reason: "signature_version" });
  });
  it("never fetches a certificate from a non-AWS host", async () => {
    let fetched = false;
    const evil = signed({ SigningCertURL: "https://evil.example.com/cert.pem" });
    const r = await verifySnsMessage(evil, {
      ...opts,
      fetchCert: async () => ((fetched = true), pem),
    });
    expect(r).toMatchObject({ ok: false, reason: "untrusted_cert_url" });
    expect(fetched).toBe(false);
  });
  it("reports an unreachable certificate and garbage signatures without throwing", async () => {
    expect(
      await verifySnsMessage(signed(), {
        ...opts,
        fetchCert: async () => {
          throw new Error("net");
        },
      }),
    ).toMatchObject({ reason: "cert_unavailable" });
    expect(
      await verifySnsMessage({ ...signed(), Signature: "!!!" }, opts),
    ).toMatchObject({ ok: false });
    expect(
      await verifySnsMessage(signed(), { ...opts, fetchCert: async () => "not a key" }),
    ).toMatchObject({ ok: false });
  });
  it("trusts only SNS hosts for certs and subscribe callbacks", () => {
    for (const u of [
      "http://sns.eu-west-1.amazonaws.com/x.pem",
      "https://sns.eu-west-1.amazonaws.com.evil.com/x.pem",
      "https://evil.com/sns.eu-west-1.amazonaws.com/x.pem",
      "https://sns.eu-west-1.amazonaws.com:8443/x.pem",
      "https://user@sns.eu-west-1.amazonaws.com/x.pem",
      "https://sns.eu-west-1.amazonaws.com/x.txt",
      "not a url",
    ])
      expect(isTrustedCertUrl(u)).toBe(false);
    expect(isTrustedCertUrl(CERT_URL)).toBe(true);
    expect(
      isTrustedSubscribeUrl(
        "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription",
      ),
    ).toBe(true);
    expect(isTrustedSubscribeUrl("https://169.254.169.254/")).toBe(false);
  });
  it("parses only complete SNS envelopes", () => {
    expect(parseSnsMessage(JSON.stringify(signed()))).not.toBeNull();
    expect(parseSnsMessage("{}")).toBeNull();
    expect(parseSnsMessage("nope")).toBeNull();
    expect(parseSnsMessage(JSON.stringify({ ...signed(), Type: "Other" }))).toBeNull();
  });
});
