import { describe, expect, it } from "vitest";
import { dayNotes, isPoorSendDay, isWeekend, nextGoodSendDay } from "./calendar";

const names = (d: string) => dayNotes(d).map((n) => `${n.kind}:${n.name}`);

describe("Turkish send calendar", () => {
  it("knows the fixed national holidays", () => {
    expect(names("2026-10-29")).toEqual(["closed:Cumhuriyet Bayramı"]);
    expect(names("2026-10-28")[0]).toMatch(/^half:/);
    expect(names("2027-01-01")).toEqual(["closed:Yılbaşı"]);
    expect(names("2026-07-15")[0]).toMatch(/^closed:Demokrasi/);
  });
  it("knows the 2026 and 2027 religious bayrams including the arife half day", () => {
    expect(names("2026-03-19")).toEqual(["half:Ramazan Bayramı arifesi (yarım gün)"]);
    for (const d of ["2026-03-20", "2026-03-21", "2026-03-22"])
      expect(names(d)).toEqual(["closed:Ramazan Bayramı"]);
    expect(names("2026-03-23")).toEqual([]);
    expect(names("2026-05-26")[0]).toMatch(/^half:Kurban/);
    for (const d of ["2026-05-27", "2026-05-30"])
      expect(names(d)).toEqual(["closed:Kurban Bayramı"]);
    expect(names("2027-03-10")).toEqual(["closed:Ramazan Bayramı"]);
    expect(names("2027-05-19")).toEqual(
      expect.arrayContaining(["closed:Kurban Bayramı"]),
    ); // also 19 Mayıs
  });
  it("does not guess bayrams outside the table", () => {
    expect(names("2030-03-20")).toEqual([]);
  });
  it("computes floating observances", () => {
    expect(names("2026-05-10")).toEqual(["info:Anneler Günü"]); // 2nd Sunday of May 2026
    expect(names("2026-06-21")).toEqual(["info:Babalar Günü"]); // 3rd Sunday of June 2026
    expect(names("2026-11-27")).toEqual(["info:Kara Cuma"]); // day after the 4th Thursday
    expect(names("2027-11-26")).toEqual(["info:Kara Cuma"]); // 2027: Thanksgiving is Nov 25
    expect(names("2023-11-24")).toEqual(expect.arrayContaining(["info:Kara Cuma"])); // a year with 5 Fridays: 4th Thu = Nov 23
    expect(names("2026-02-14")).toEqual(["info:Sevgililer Günü"]);
  });
  it("information days are not 'poor' send days; holidays, half days and weekends are", () => {
    expect(isPoorSendDay("2026-02-14")).toBe(true); // a Saturday
    expect(isPoorSendDay("2026-11-27")).toBe(false); // Black Friday is a Friday
    expect(isPoorSendDay("2026-10-29")).toBe(true);
    expect(isPoorSendDay("2026-10-28")).toBe(true);
    expect(isPoorSendDay("2026-10-27")).toBe(false);
    expect(isWeekend("2026-10-24")).toBe(true);
  });
  it("proposes the next good day, skipping a whole bayram and the weekend after it", () => {
    expect(nextGoodSendDay("2026-10-27")).toBeNull();
    expect(nextGoodSendDay("2026-05-27")).toBe("2026-06-01"); // bayram until Sat 30th, Sun 31st → Monday
    expect(nextGoodSendDay("2026-10-29")).toBe("2026-10-30"); // Thursday holiday → Friday is an ordinary day
  });
  it("is robust to bad input", () => {
    expect(dayNotes("nope")).toEqual([]);
    expect(nextGoodSendDay("nope")).toBeNull();
    expect(dayNotes("2026-02-30")).toBeDefined();
  });
});
