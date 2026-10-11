/*
 * Turkish send-timing calendar. Mail sent into a bayram, an official holiday or a weekend is read less (and B2B audiences
 * are away), so the scheduler warns and proposes the next good day. Pure, browser-safe, dates are calendar dates
 * ("YYYY-MM-DD") in the workspace's own timezone.
 *
 * Fixed national holidays are exact. Religious bayrams move with the lunar calendar, so they come from a table covering
 * 2026–2027 (Diyanet dates). OUTSIDE the table no bayram warning is shown — extend it each year; never guessed.
 */

export type DayNote = { name: string; kind: "closed" | "half" | "info" };

const FIXED_CLOSED: Record<string, string> = {
  "01-01": "Yılbaşı",
  "04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
  "05-01": "Emek ve Dayanışma Günü",
  "05-19": "Atatürk'ü Anma, Gençlik ve Spor Bayramı",
  "07-15": "Demokrasi ve Millî Birlik Günü",
  "08-30": "Zafer Bayramı",
  "10-29": "Cumhuriyet Bayramı",
};
const FIXED_HALF: Record<string, string> = {
  "10-28": "Cumhuriyet Bayramı arifesi (yarım gün)",
};
const FIXED_INFO: Record<string, string> = {
  "02-14": "Sevgililer Günü",
  "03-08": "Dünya Kadınlar Günü",
  "11-24": "Öğretmenler Günü",
  "12-31": "Yılbaşı gecesi",
};

/** Religious holidays by year: [name, first closed day, last closed day]; the day before the first is a half day. */
const RELIGIOUS: Record<number, [string, string, string][]> = {
  2026: [
    ["Ramazan Bayramı", "2026-03-20", "2026-03-22"],
    ["Kurban Bayramı", "2026-05-27", "2026-05-30"],
  ],
  2027: [
    ["Ramazan Bayramı", "2027-03-09", "2027-03-11"],
    ["Kurban Bayramı", "2027-05-16", "2027-05-19"],
  ],
};
export const CALENDAR_YEARS = Object.keys(RELIGIOUS).map(Number);

const parse = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
};
const fmt = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
  fmt(new Date(parse(d)!.getTime() + n * 86_400_000));
const between = (d: string, a: string, b: string) => d >= a && d <= b;

/** Nth weekday (0=Sunday) of a month, e.g. 2nd Sunday of May. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return fmt(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)));
}

export function dayNotes(day: string): DayNote[] {
  const date = parse(day);
  if (!date) return [];
  const year = date.getUTCFullYear();
  const md = day.slice(5);
  const notes: DayNote[] = [];
  if (FIXED_CLOSED[md]) notes.push({ name: FIXED_CLOSED[md]!, kind: "closed" });
  if (FIXED_HALF[md]) notes.push({ name: FIXED_HALF[md]!, kind: "half" });
  if (FIXED_INFO[md]) notes.push({ name: FIXED_INFO[md]!, kind: "info" });
  for (const [name, start, end] of RELIGIOUS[year] ?? []) {
    if (between(day, start, end)) notes.push({ name, kind: "closed" });
    else if (day === addDays(start, -1))
      notes.push({ name: `${name} arifesi (yarım gün)`, kind: "half" });
  }
  if (day === nthWeekday(year, 5, 0, 2))
    notes.push({ name: "Anneler Günü", kind: "info" });
  if (day === nthWeekday(year, 6, 0, 3))
    notes.push({ name: "Babalar Günü", kind: "info" });
  // Black Friday = the day after the 4th Thursday of November (not always the 4th Friday).
  if (day === addDays(nthWeekday(year, 11, 4, 4), 1))
    notes.push({ name: "Kara Cuma", kind: "info" });
  return notes;
}

export const isWeekend = (day: string) => {
  const d = parse(day)?.getUTCDay();
  return d === 0 || d === 6;
};

/** True when a day is a poor choice for a business send: official/religious holiday, half day, or weekend. */
export function isPoorSendDay(day: string): boolean {
  return isWeekend(day) || dayNotes(day).some((n) => n.kind !== "info");
}

/** The next day (within 14) that is not a holiday, half day or weekend; null if the date itself is already fine. */
export function nextGoodSendDay(day: string): string | null {
  if (!parse(day) || !isPoorSendDay(day)) return null;
  for (let i = 1; i <= 14; i++) {
    const candidate = addDays(day, i);
    if (!isPoorSendDay(candidate)) return candidate;
  }
  return null;
}
