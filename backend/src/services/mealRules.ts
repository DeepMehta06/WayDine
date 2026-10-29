import type { GraphRankedRestaurant, MealFilteredRestaurant, MealType, OpeningPeriod } from "../types/index.js";

const MEAL_WINDOWS: Array<{ meal: MealType; startMin: number; endMin: number }> = [
  { meal: "breakfast", startMin: 5 * 60, endMin: 11 * 60 },
  { meal: "lunch", startMin: 11 * 60, endMin: 16 * 60 },
  { meal: "snacks", startMin: 16 * 60, endMin: 19 * 60 },
  { meal: "dinner", startMin: 19 * 60, endMin: 29 * 60 }, // wraps past midnight (24:00-05:00 -> 24-29h)
];

function timeToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function mealForArrival(arrival: Date): MealType {
  const minutes = timeToMinutes(arrival);
  for (const window of MEAL_WINDOWS) {
    const end = window.endMin % (24 * 60);
    const wrapsMidnight = window.endMin >= 24 * 60;
    if (wrapsMidnight) {
      if (minutes >= window.startMin || minutes < end) return window.meal;
    } else if (minutes >= window.startMin && minutes < end) {
      return window.meal;
    }
  }
  return "dinner";
}

function parseTimeOnDate(date: Date, hhmmss: string): Date {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, s ?? 0, 0);
  return d;
}

/** True if `closes_at` <= `opens_at`, i.e. the window crosses midnight. */
function crossesMidnight(opensAt: string, closesAt: string): boolean {
  return closesAt <= opensAt;
}

function isOpenAt(hours: OpeningPeriod[], arrival: Date): boolean {
  const weekday = arrival.getDay();
  const relevant = hours.filter((h) => h.weekday === weekday);

  for (const h of relevant) {
    const opens = parseTimeOnDate(arrival, h.opens_at);
    let closes = parseTimeOnDate(arrival, h.closes_at);
    if (crossesMidnight(h.opens_at, h.closes_at)) {
      closes = new Date(closes.getTime() + 24 * 60 * 60 * 1000);
    }
    if (arrival >= opens && arrival <= closes) return true;
  }

  // Also check the previous day's window in case it crosses midnight into today.
  const prevWeekday = (weekday + 6) % 7;
  const prevDayRelevant = hours.filter(
    (h) => h.weekday === prevWeekday && crossesMidnight(h.opens_at, h.closes_at)
  );
  for (const h of prevDayRelevant) {
    const prevDate = new Date(arrival.getTime() - 24 * 60 * 60 * 1000);
    const opens = parseTimeOnDate(prevDate, h.opens_at);
    const closes = new Date(
      parseTimeOnDate(prevDate, h.closes_at).getTime() + 24 * 60 * 60 * 1000
    );
    if (arrival >= opens && arrival <= closes) return true;
  }

  return false;
}

function etaStringToDate(departureTime: Date, etaArrival: string): Date {
  const [h, m] = etaArrival.split(":").map(Number);
  const d = new Date(departureTime);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d < departureTime) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Attaches the recommended meal type and open/closed status for each
 * candidate's arrival time. `openAtArrival` is null (unknown) only when
 * Mapbox has no hours data for that specific place — most POIs do carry
 * structured hours via the Search Box API's metadata.open_hours.
 */
export function applyMealRules(
  candidates: GraphRankedRestaurant[],
  departureTime: Date
): MealFilteredRestaurant[] {
  return candidates.map((candidate) => {
    const arrivalDate = etaStringToDate(departureTime, candidate.etaArrival);
    const openAtArrival = candidate.openingHours.length > 0 ? isOpenAt(candidate.openingHours, arrivalDate) : null;
    return { ...candidate, mealRecommended: mealForArrival(arrivalDate), openAtArrival };
  });
}
