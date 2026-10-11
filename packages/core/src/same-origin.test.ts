import { describe, expect, it } from "vitest";
import { clientIpFrom, isSameOrigin, type OriginInput } from "./same-origin";

const base: OriginInput = {
  origin: null,
  referer: null,
  host: "mailory.io",
  forwardedHost: "mailory.io",
  forwardedProto: "https",
  nextOrigin: "http://0.0.0.0:3000",
  appUrl: "https://mailory.io",
};

describe("isSameOrigin", () => {
  it("accepts the public origin behind a proxy", () => {
    expect(isSameOrigin({ ...base, origin: "https://mailory.io" })).toBe(true);
  });
  it("rejects a cross-site origin", () => {
    expect(isSameOrigin({ ...base, origin: "https://evil.example" })).toBe(false);
  });
  it("rejects when neither Origin nor Referer is present", () => {
    expect(isSameOrigin(base)).toBe(false);
  });
  it("falls back to Referer", () => {
    expect(isSameOrigin({ ...base, referer: "https://mailory.io/login" })).toBe(true);
    expect(isSameOrigin({ ...base, referer: "https://evil.example/x" })).toBe(false);
    expect(isSameOrigin({ ...base, referer: "not a url" })).toBe(false);
  });
  it("ignores a malformed APP_URL", () => {
    expect(
      isSameOrigin({ ...base, appUrl: "::", origin: "https://evil.example" }),
    ).toBe(false);
  });
});

describe("clientIpFrom", () => {
  it("uses the last (proxy-appended) hop, not the spoofable first", () => {
    expect(clientIpFrom("1.1.1.1, 2.2.2.2, 9.9.9.9")).toBe("9.9.9.9");
  });
  it("returns unknown without the header", () => {
    expect(clientIpFrom(null)).toBe("unknown");
  });
});
