import { describe, expect, it } from "vitest";
import { reviewMergeFor } from "./merge-review";

const ok = { subject: "Merhaba", text: "Merhaba Ayşe" };
const codes = (texts: string[], values: Record<string, string | null>, r = ok) =>
  reviewMergeFor(texts, values, r).map((i) => `${i.code}${i.key ? ":" + i.key : ""}`);

describe("pre-send review of one recipient", () => {
  it("flags an empty value without a fallback, but not one with a fallback", () => {
    expect(codes(["Merhaba {{first_name}}"], { first_name: "" })).toEqual([
      "empty_value:first_name",
    ]);
    expect(codes(["Merhaba {{first_name|dostum}}"], { first_name: null })).toEqual([]);
    expect(codes(["Merhaba {{first_name:e|dostuna}}"], { first_name: " " })).toEqual(
      [],
    );
  });
  it("never flags system tokens", () => {
    expect(codes(["{{unsubscribe_url}} {{org_name}}"], {})).toEqual([]);
  });
  it("flags names stored in CAPS unless a title/upper/suffix filter handles them", () => {
    expect(codes(["{{first_name}}"], { first_name: "AYŞE" })).toEqual([
      "all_caps:first_name",
    ]);
    expect(codes(["{{first_name:title}}"], { first_name: "AYŞE" })).toEqual([]);
    expect(codes(["{{first_name:e}}"], { first_name: "AYŞE" })).toEqual([]);
    expect(codes(["{{first_name}}"], { first_name: "Ayşe" })).toEqual([]);
    expect(codes(["{{first_name}}"], { first_name: "A" })).toEqual([
      "odd_name:first_name",
    ]);
  });
  it("flags names that are really e-mail addresses or numbers", () => {
    expect(codes(["{{first_name|dost}}"], { first_name: "ali@x.com" })).toEqual([
      "odd_name:first_name",
    ]);
    expect(codes(["{{first_name|dost}}"], { first_name: "12345" })).toEqual([
      "odd_name:first_name",
    ]);
    expect(codes(["{{company}}"], { company: "3M" })).toEqual([]); // company names may contain digits
  });
  it("flags a too-long merged subject and stray punctuation left by an empty field", () => {
    expect(codes([], {}, { subject: "x".repeat(81), text: "" })).toEqual([
      "long_subject",
    ]);
    expect(codes([], {}, { subject: "Merhaba , nasılsınız", text: "" })).toEqual([
      "stray_punctuation",
    ]);
    expect(
      codes([], {}, { subject: "Merhaba", text: "Selam\n , bu bir mesaj" }),
    ).toEqual(["stray_punctuation"]);
    expect(
      codes([], {}, { subject: "Merhaba, nasılsınız", text: "Selam, dünya." }),
    ).toEqual([]);
  });
  it("reports each problem once however often the token is used", () => {
    expect(
      codes(["{{first_name}} {{first_name}}", "{{first_name}}"], { first_name: "" }),
    ).toEqual(["empty_value:first_name"]);
  });
});
