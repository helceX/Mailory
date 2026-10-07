import { describe, expect, it } from "vitest";
import {
  domainOfEmail,
  findCoveringDomain,
  isFreeMailDomain,
  isPlatformDomain,
  normalizeDomain,
} from "./domain";

describe("normalizeDomain", () => {
  it("normalizes case, scheme, path, www and trailing dot", () => {
    expect(normalizeDomain(" Example.COM ")).toBe("example.com");
    expect(normalizeDomain("https://www.Example.com/path?x=1")).toBe("example.com");
    expect(normalizeDomain("mail.example.com.")).toBe("mail.example.com");
    expect(normalizeDomain("btm.org.tr")).toBe("btm.org.tr");
  });
  it("rejects things that are not public hostnames", () => {
    for (const bad of [
      "",
      "com",
      "localhost",
      "exa mple.com",
      "a..b.com",
      "-bad.com",
      "bad-.com",
      "10.0.0.1",
      "example.c",
      "ex_ample.com",
      "例え.jp",
      "a".repeat(64) + ".com",
      "x@y.com",
    ]) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe("email helpers", () => {
  it("extracts the domain of an address", () => {
    expect(domainOfEmail("Ayşe@News.Example.com")).toBe("news.example.com");
    expect(domainOfEmail("nope")).toBeNull();
    expect(domainOfEmail("@example.com")).toBeNull();
  });
  it("flags free mailbox providers", () => {
    for (const d of [
      "gmail.com",
      "Hotmail.com",
      "yahoo.com.tr",
      "icloud.com",
      "yandex.com.tr",
    ])
      expect(isFreeMailDomain(d), d).toBe(true);
    expect(isFreeMailDomain("example.com")).toBe(false);
  });
  it("recognizes the platform domain and its subdomains, not look-alikes", () => {
    expect(isPlatformDomain("mailory.io", "app.mailory.io")).toBe(true);
    expect(isPlatformDomain("news.mailory.io", "app.mailory.io")).toBe(true);
    expect(isPlatformDomain("evilmailory.io", "app.mailory.io")).toBe(false);
    expect(isPlatformDomain("mailory.io.evil.com", "app.mailory.io")).toBe(false);
  });
});

describe("findCoveringDomain", () => {
  const domains = [
    { domain: "example.com", id: 1 },
    { domain: "mail.example.com", id: 2 },
    { domain: "other.org", id: 3 },
  ];
  it("matches exact domains and subdomains, preferring the most specific", () => {
    expect(findCoveringDomain(domains, "example.com")?.id).toBe(1);
    expect(findCoveringDomain(domains, "news.example.com")?.id).toBe(1);
    expect(findCoveringDomain(domains, "a.mail.example.com")?.id).toBe(2);
  });
  it("never matches look-alike suffixes or parents", () => {
    expect(findCoveringDomain(domains, "notexample.com")).toBeNull();
    expect(findCoveringDomain(domains, "com")).toBeNull();
    expect(findCoveringDomain(domains, "example.com.evil.org")).toBeNull();
  });
});
