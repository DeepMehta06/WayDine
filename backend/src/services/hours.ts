/**
 * Opening-hours evaluation at an absolute arrival instant, in restaurant-local
 * (Asia/Kolkata) time. Mapbox weekly periods become week-minute intervals that
 * honour close.day (multi-day and overnight periods); OSM `opening_hours`
 * strings use the standard parser. Missing, malformed or conflicting data is
 * reported as unknown, never guessed.
 */
import OpeningHours from "opening_hours";
import type { RestaurantProvider as Provider } from "../contract/api.js";
import type { HoursSource, MapboxPeriod } from "../domain/venue.js";
import { minuteOfWeek, wallClockAsLocalDate } from "../lib/time.js";

const WEEK = 7 * 1440;

export interface HoursEvaluation {
  atArrival: "open" | "closed" | "unknown";
  closesWithinMinutes: number | null;
  source: Provider | null;
  text: string | null;
  conflict: boolean;
}

function hhmmToMinutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
}

/** Returns null when the schedule cannot be interpreted safely. */
export function periodsToIntervals(periods: MapboxPeriod[]): Array<[number, number]> | null {
  if (periods.length === 0) return null;
  if (periods.length === 1 && !periods[0]!.close && periods[0]!.open.time === "0000") {
    return [[0, WEEK]];
  }
  const intervals: Array<[number, number]> = [];
  for (const p of periods) {
    if (!p.close) return null;
    const start = p.open.day * 1440 + hhmmToMinutes(p.open.time);
    let end = p.close.day * 1440 + hhmmToMinutes(p.close.time);
    if (end <= start) {
      // Same-day close at or before opening (e.g. 16:30 -> 00:30, observed in
      // live Mapbox data) means the next day. A cross-day close earlier in the
      // week (Sat 22:00 -> Sun 03:00) wraps the week.
      end += p.close.day === p.open.day ? 1440 : WEEK;
    }
    intervals.push([start, end]);
  }
  return intervals;
}

export function evaluateIntervals(intervals: Array<[number, number]>, instant: Date): { open: boolean; minutesToClose: number | null } {
  const m = minuteOfWeek(instant);
  for (const [s, e] of intervals) {
    if (e - s >= WEEK) return { open: true, minutesToClose: null };
    for (const candidate of [m, m + WEEK]) {
      if (candidate >= s && candidate < e) return { open: true, minutesToClose: e - candidate };
    }
  }
  return { open: false, minutesToClose: null };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (t: string) => `${t.slice(0, 2)}:${t.slice(2, 4)}`;

/** Compact human summary, e.g. "Mon–Sun 10:00–23:00". */
export function describePeriods(periods: MapboxPeriod[]): string {
  if (periods.length === 1 && !periods[0]!.close && periods[0]!.open.time === "0000") return "Open 24 hours";
  const byDay = new Map<number, string[]>();
  for (const p of periods) {
    const overnight = p.close && p.close.time !== "0000" && (p.close.day !== p.open.day || p.close.time < p.open.time);
    const label = p.close ? `${fmt(p.open.time)}–${fmt(p.close.time)}${overnight ? " (next day)" : ""}` : `from ${fmt(p.open.time)}`;
    byDay.set(p.open.day, [...(byDay.get(p.open.day) ?? []), label]);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: Array<{ days: number[]; text: string }> = [];
  for (const d of order) {
    const text = (byDay.get(d) ?? ["closed"]).join(", ");
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.days.push(d);
    else groups.push({ days: [d], text });
  }
  return groups
    .map((g) => `${DAY[g.days[0]!]}${g.days.length > 1 ? `–${DAY[g.days[g.days.length - 1]!]}` : ""} ${g.text}`)
    .join("; ");
}

function evaluateSource(src: HoursSource, instant: Date): { state: "open" | "closed" | "unknown"; minutesToClose: number | null; text: string } {
  if (src.kind === "google") {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: src.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
    const inCurrent = src.currentFrom !== null && src.currentThrough !== null && date >= src.currentFrom && date <= src.currentThrough;
    const periods = inCurrent ? src.current : src.regular;
    const intervals = periods ? periodsToIntervals(periods) : null;
    const text = src.text ?? (periods ? describePeriods(periods) : "");
    if (!intervals) return { state: "unknown", minutesToClose: null, text };
    const m = minuteOfWeek(instant, src.timeZone);
    for (const [start, end] of intervals) {
      if (end - start >= WEEK) return { state: "open", minutesToClose: null, text };
      for (const candidate of [m, m + WEEK]) if (candidate >= start && candidate < end) return { state: "open", minutesToClose: end - candidate, text };
    }
    return { state: "closed", minutesToClose: null, text };
  }
  if (src.kind === "weekly-periods") {
    const intervals = periodsToIntervals(src.periods);
    const text = describePeriods(src.periods);
    if (!intervals) return { state: "unknown", minutesToClose: null, text };
    const r = evaluateIntervals(intervals, instant);
    return { state: r.open ? "open" : "closed", minutesToClose: r.minutesToClose, text };
  }
  try {
    const oh = new OpeningHours(src.text, null);
    const local = wallClockAsLocalDate(instant);
    if (oh.getUnknown(local)) return { state: "unknown", minutesToClose: null, text: src.text };
    const open = oh.getState(local);
    let minutesToClose: number | null = null;
    if (open) {
      const horizon = new Date(local.getTime() + 8 * 86_400_000);
      const next = oh.getNextChange(local, horizon);
      minutesToClose = next ? Math.round((next.getTime() - local.getTime()) / 60_000) : null;
    }
    return { state: open ? "open" : "closed", minutesToClose, text: src.text };
  } catch {
    return { state: "unknown", minutesToClose: null, text: src.text };
  }
}

export function evaluateHours(sources: HoursSource[], arrival: Date): HoursEvaluation {
  if (sources.length === 0) {
    return { atArrival: "unknown", closesWithinMinutes: null, source: null, text: null, conflict: false };
  }
  const results = sources.map((s) => ({ src: s, ...evaluateSource(s, arrival) }));
  const known = results.filter((r) => r.state !== "unknown");
  const primary = known[0] ?? results[0]!;
  const conflict = new Set(known.map((r) => r.state)).size > 1;
  if (conflict || known.length === 0) {
    return { atArrival: "unknown", closesWithinMinutes: null, source: primary.src.provider, text: primary.text, conflict };
  }
  return {
    atArrival: primary.state,
    closesWithinMinutes:
      primary.state === "open" && primary.minutesToClose !== null && primary.minutesToClose <= 60
        ? primary.minutesToClose
        : null,
    source: primary.src.provider,
    text: primary.text,
    conflict: false,
  };
}
