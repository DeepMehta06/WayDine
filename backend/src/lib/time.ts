/**
 * Restaurant-local time. The service's documented scope is India, so all
 * opening-hours and meal-time decisions use Asia/Kolkata wall-clock time
 * derived from absolute instants, independent of the server's timezone.
 */
export const RESTAURANT_TIME_ZONE = "Asia/Kolkata";

export interface WallClock {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: RESTAURANT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function wallClock(instant: Date, timeZone = RESTAURANT_TIME_ZONE): WallClock {
  const fmt =
    timeZone === RESTAURANT_TIME_ZONE
      ? partsFormatter
      : new Intl.DateTimeFormat("en-US", {
          timeZone,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          weekday: "short",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Minutes since Sunday 00:00 local time (0..10079). */
export function minuteOfWeek(instant: Date, timeZone = RESTAURANT_TIME_ZONE): number {
  const w = wallClock(instant, timeZone);
  return w.weekday * 1440 + w.hour * 60 + w.minute;
}

/**
 * A Date whose *local* getters return the restaurant wall-clock time. Needed
 * for libraries (the OSM opening_hours parser) that read local getters.
 * Only use it to feed such libraries; never compare it with real instants.
 */
export function wallClockAsLocalDate(instant: Date, timeZone = RESTAURANT_TIME_ZONE): Date {
  const w = wallClock(instant, timeZone);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

export type MealPeriod = "breakfast" | "lunch" | "snacks" | "dinner" | "late night";

/** A time-of-day label only. It says nothing about what a restaurant serves. */
export function mealPeriodAt(instant: Date, timeZone = RESTAURANT_TIME_ZONE): MealPeriod {
  const w = wallClock(instant, timeZone);
  const m = w.hour * 60 + w.minute;
  if (m >= 5 * 60 && m < 11 * 60) return "breakfast";
  if (m >= 11 * 60 && m < 16 * 60) return "lunch";
  if (m >= 16 * 60 && m < 19 * 60) return "snacks";
  if (m >= 19 * 60 && m < 23 * 60) return "dinner";
  return "late night";
}
