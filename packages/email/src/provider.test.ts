import { describe, expect, it, vi } from "vitest";
import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
} from "@aws-sdk/client-sesv2";
import { SesDomainProvider } from "./provider";

const tokens = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
const fake = () => {
  const send = vi.fn();
  const provider = new SesDomainProvider("eu-central-1", { send } as never);
  return { provider, send };
};
const error = (name: string) => Object.assign(new Error(name), { name });

describe("SES domain provider", () => {
  it("returns SES-issued tokens and reuses existing identities without rotating keys", async () => {
    const { provider, send } = fake();
    send.mockResolvedValueOnce({ DkimAttributes: { Tokens: tokens } });
    expect(await provider.createIdentity("example.com")).toEqual({
      dkimTokens: tokens,
    });
    expect(send.mock.calls[0]![0]).toBeInstanceOf(CreateEmailIdentityCommand);
    expect(send.mock.calls[0]![0].input).toEqual({ EmailIdentity: "example.com" });
    send
      .mockRejectedValueOnce(error("AlreadyExistsException"))
      .mockResolvedValueOnce({ DkimAttributes: { Tokens: tokens } });
    expect(await provider.createIdentity("example.com")).toEqual({
      dkimTokens: tokens,
    });
    expect(send.mock.calls[2]![0]).toBeInstanceOf(GetEmailIdentityCommand);
  });
  it("rejects unusable keys and preserves provider errors", async () => {
    for (const value of [
      undefined,
      [],
      [tokens[0]],
      [tokens[0], tokens[0], tokens[0]],
      ["bad", tokens[1], tokens[2]],
    ]) {
      const { provider, send } = fake();
      send.mockResolvedValue({ DkimAttributes: { Tokens: value } });
      await expect(provider.createIdentity("example.com")).rejects.toThrow(/Easy DKIM/);
    }
    const { provider, send } = fake();
    send.mockRejectedValue(error("AccessDeniedException"));
    await expect(provider.createIdentity("example.com")).rejects.toThrow(
      "AccessDeniedException",
    );
  });
  it("requires SES signing and sending approval, independently of DNS", async () => {
    const { provider, send } = fake();
    for (const [status, expected] of [
      ["PENDING", "pending"],
      ["FAILED", "failed"],
      ["NOT_STARTED", "not_started"],
      ["SUCCESS", "success"],
    ]) {
      send.mockResolvedValueOnce({
        DkimAttributes: { Status: status, SigningEnabled: true },
        VerifiedForSendingStatus: true,
      });
      expect(await provider.getIdentityStatus("example.com")).toEqual({
        dkim: expected,
      });
    }
    for (const [signing, verified] of [
      [false, true],
      [true, false],
    ]) {
      send.mockResolvedValueOnce({
        DkimAttributes: { Status: "SUCCESS", SigningEnabled: signing },
        VerifiedForSendingStatus: verified,
      });
      expect(await provider.getIdentityStatus("example.com")).toEqual({
        dkim: "pending",
      });
    }
  });
  it("treats missing identities as unverified and transient errors as inconclusive", async () => {
    const { provider, send } = fake();
    send.mockRejectedValueOnce(error("NotFoundException"));
    expect(await provider.getIdentityStatus("example.com")).toEqual({
      dkim: "not_started",
    });
    send.mockResolvedValueOnce({ DkimAttributes: { Status: "TEMPORARY_FAILURE" } });
    await expect(provider.getIdentityStatus("example.com")).rejects.toThrow(
      /temporarily/,
    );
    send.mockRejectedValueOnce(error("TooManyRequestsException"));
    await expect(provider.getIdentityStatus("example.com")).rejects.toThrow(
      "TooManyRequestsException",
    );
  });
  it("deletes idempotently without swallowing permission failures", async () => {
    const { provider, send } = fake();
    send.mockResolvedValueOnce({});
    await provider.deleteIdentity("example.com");
    expect(send.mock.calls[0]![0]).toBeInstanceOf(DeleteEmailIdentityCommand);
    send.mockRejectedValueOnce(error("NotFoundException"));
    await expect(provider.deleteIdentity("example.com")).resolves.toBeUndefined();
    send.mockRejectedValueOnce(error("AccessDeniedException"));
    await expect(provider.deleteIdentity("example.com")).rejects.toThrow(
      "AccessDeniedException",
    );
  });
});
