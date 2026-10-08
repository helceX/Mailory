import { describe, expect, it } from "vitest";
import { applyMerge } from "./email-markup";
import { applyMergeFilter, trSuffix, trTitleCase } from "./turkish";

const cases: [string, string, string][] = [
  // [name, suffix, expected]
  ["Ayşe", "e", "Ayşe'ye"],
  ["Ali", "e", "Ali'ye"],
  ["Ahmet", "e", "Ahmet'e"],
  ["Can", "e", "Can'a"],
  ["Ömer", "e", "Ömer'e"],
  ["Zeynep", "e", "Zeynep'e"],
  ["Mustafa", "e", "Mustafa'ya"],
  ["Murat", "e", "Murat'a"],
  ["Burcu", "e", "Burcu'ya"],
  ["Emre", "e", "Emre'ye"],
  ["Hülya", "e", "Hülya'ya"],
  ["Gökhan", "e", "Gökhan'a"],
  ["Özlem", "e", "Özlem'e"],
  ["Ümit", "e", "Ümit'e"],
  ["Işık", "e", "Işık'a"],
  ["Mehmet Ali", "e", "Mehmet Ali'ye"],
  ["Kemal", "e", "Kemal'e"],
  ["Nihal", "e", "Nihal'e"],
  ["Ayşe", "in", "Ayşe'nin"],
  ["Ahmet", "in", "Ahmet'in"],
  ["Can", "in", "Can'ın"],
  ["Burcu", "in", "Burcu'nun"],
  ["Ümit", "in", "Ümit'in"],
  ["Hülya", "in", "Hülya'nın"],
  ["Kemal", "in", "Kemal'in"],
  ["Ali", "in", "Ali'nin"],
  ["Ayşe", "i", "Ayşe'yi"],
  ["Ahmet", "i", "Ahmet'i"],
  ["Can", "i", "Can'ı"],
  ["Burcu", "i", "Burcu'yu"],
  ["Ömer", "i", "Ömer'i"],
  ["Murat", "i", "Murat'ı"],
  ["Ümit", "i", "Ümit'i"],
  ["Ahmet", "de", "Ahmet'te"],
  ["Ali", "de", "Ali'de"],
  ["Can", "de", "Can'da"],
  ["Murat", "de", "Murat'ta"],
  ["Işık", "de", "Işık'ta"],
  ["Zeynep", "de", "Zeynep'te"],
  ["Ahmet", "den", "Ahmet'ten"],
  ["Ali", "den", "Ali'den"],
  ["Can", "den", "Can'dan"],
  ["Murat", "den", "Murat'tan"],
];

describe("trSuffix", () => {
  it.each(cases)("%s + %s → %s", (name, suffix, expected) =>
    expect(trSuffix(name, suffix as never)).toBe(expected),
  );
  it("leaves unusable values alone instead of inventing a suffix", () => {
    expect(trSuffix("", "e")).toBe("");
    expect(trSuffix("123", "e")).toBe("123");
    expect(trSuffix("Ts", "e")).toBe("Ts");
    expect(trSuffix("A. B.", "e")).toBe("A. B."); // no vowel to harmonize with
  });
});

describe("trTitleCase", () => {
  it("applies Turkish i/ı rules", () => {
    expect(trTitleCase("AYŞE")).toBe("Ayşe");
    expect(trTitleCase("ISPARTA")).toBe("Isparta");
    expect(trTitleCase("İSMAİL ÇAĞRI")).toBe("İsmail Çağrı");
    expect(trTitleCase("ali veli")).toBe("Ali Veli");
    expect(trTitleCase("ayşe-nur")).toBe("Ayşe-Nur");
  });
});

describe("merge filters in templates", () => {
  const values = { first_name: "AYŞE", company: "ışık ltd" };
  const id = (v: string) => v;
  it("supports key:filter and key:filter|fallback", () => {
    expect(applyMerge("Merhaba {{first_name:e}}!", values, id)).toBe(
      "Merhaba Ayşe'ye!",
    );
    expect(applyMerge("{{first_name:title}}", values, id)).toBe("Ayşe");
    expect(applyMerge("{{company:title}}", values, id)).toBe("Işık Ltd");
    expect(applyMerge("{{nope:e|dostuna}}", values, id)).toBe("dostuna");
    expect(applyMerge("{{ first_name :e }}", values, id)).toBe("Ayşe'ye");
  });
  it("an unknown filter never breaks a send", () => {
    expect(applyMerge("{{first_name:zzz}}", values, id)).toBe("AYŞE");
    expect(applyMergeFilter("Ali", undefined)).toBe("Ali");
  });
  it("existing {{key|fallback}} behaviour is unchanged", () => {
    expect(applyMerge("{{first_name|dost}}", { first_name: "" }, id)).toBe("dost");
    expect(applyMerge("{{first_name|dost}}", { first_name: "Ali" }, id)).toBe("Ali");
  });
  it("suffixed values are escaped by the caller's encoder like any other value", () => {
    expect(
      applyMerge("{{first_name:e}}", { first_name: "<b>Ali</b>" }, (v) =>
        v.replace(/</g, "&lt;"),
      ),
    ).toContain("&lt;");
  });
});
