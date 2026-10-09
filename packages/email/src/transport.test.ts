import { describe, expect, it } from "vitest";
import {
  ConsoleTransport,
  SesTransport,
  assertHeaderSafe,
  classifySesError,
  formatAddress,
  type OutgoingEmail,
} from "./transport";

const base: OutgoingEmail = {
  from: { name: "Acme", email: "info@acme.com" },
  to: "a@example.org",
  subject: "Merhaba",
  html: "<p>x</p>",
  text: "x",
};
type Sent = { input: Record<string, unknown> };
const fakeClient = (fn: (cmd: Sent) => unknown) =>
  ({
    send: async (cmd: unknown) => fn(cmd as Sent),
  }) as never;

describe("addresses and headers", () => {
  it("quotes ASCII names and RFC2047-encodes the rest", () => {
    expect(formatAddress('Ac"me', "i@a.com")).toBe('"Ac\\"me" <i@a.com>');
    expect(formatAddress("Çiğdem Ltd.", "i@a.com")).toMatch(
      /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <i@a\.com>$/,
    );
    expect(formatAddress("", "i@a.com")).toBe("i@a.com");
  });
  it("refuses line breaks (header injection)", () => {
    expect(() => assertHeaderSafe("x", "a\r\nBcc: evil@x.com")).toThrow();
    expect(() => formatAddress("Acme\nBcc: x@y.z", "i@a.com")).toThrow();
  });
});

describe("SesTransport", () => {
  it("sends simple content with headers, tags and configuration set", async () => {
    let seen: Sent | undefined;
    const t = new SesTransport(
      { region: "eu-west-1", configurationSet: "cs" },
      fakeClient((c) => ((seen = c), { MessageId: "m-1" })),
    );
    const r = await t.send({
      ...base,
      replyTo: "r@acme.com",
      headers: {
        "List-Unsubscribe": "<https://x/u>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: { campaign_id: "c1" },
    });
    expect(r).toEqual({ ok: true, messageId: "m-1" });
    const input = seen!.input as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(input.FromEmailAddress).toBe('"Acme" <info@acme.com>');
    expect(input.ConfigurationSetName).toBe("cs");
    expect(input.ReplyToAddresses).toEqual(["r@acme.com"]);
    expect(input.EmailTags).toEqual([{ Name: "campaign_id", Value: "c1" }]);
    expect(input.Content.Simple.Headers).toHaveLength(2);
    expect(input.Content.Simple.Body.Html.Data).toBe("<p>x</p>");
  });
  it("never retries a malformed message and never calls SES", async () => {
    let called = false;
    const t = new SesTransport(
      { region: "r" },
      fakeClient(() => ((called = true), { MessageId: "x" })),
    );
    const r = await t.send({ ...base, subject: "a\nBcc: x@y.z" });
    expect(r).toMatchObject({ ok: false, retryable: false, code: "invalid_message" });
    expect(called).toBe(false);
    expect(await t.send({ ...base, headers: { "Bad Name": "v" } })).toMatchObject({
      ok: false,
      retryable: false,
    });
  });
  it("classifies provider errors", async () => {
    const mk = (err: unknown) =>
      new SesTransport({ region: "r" }, {
        send: async () => {
          throw err;
        },
      } as never);
    expect(
      await mk(
        Object.assign(new Error("slow down"), { name: "ThrottlingException" }),
      ).send(base),
    ).toMatchObject({ retryable: true });
    expect(
      await mk(
        Object.assign(new Error("boom"), {
          name: "Weird",
          $metadata: { httpStatusCode: 503 },
        }),
      ).send(base),
    ).toMatchObject({ retryable: true });
    expect(
      await mk(Object.assign(new Error("no"), { name: "MessageRejected" })).send(base),
    ).toMatchObject({ retryable: false, code: "MessageRejected" });
    expect(
      await mk(Object.assign(new Error("net"), { code: "ECONNRESET" })).send(base),
    ).toMatchObject({ retryable: true });
    expect(classifySesError("weird").retryable).toBe(false);
  });
  it("treats a missing MessageId as retryable", async () => {
    const t = new SesTransport(
      { region: "r" },
      fakeClient(() => ({})),
    );
    expect(await t.send(base)).toMatchObject({ ok: false, retryable: true });
  });
});

describe("ConsoleTransport", () => {
  it("records messages", async () => {
    const t = new ConsoleTransport(() => {});
    const r = await t.send(base);
    expect(r.ok).toBe(true);
    expect(t.sent).toHaveLength(1);
  });
});
