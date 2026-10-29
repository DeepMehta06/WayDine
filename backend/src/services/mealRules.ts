import type { GraphRankedRestaurant, MealFilteredRestaurant, MealType } from "../types/index.js";

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
 * Attaches the recommended meal type for each candidate's arrival time.
 * `openAtArrival` is left null (unknown) rather than fetched from a curated
 * opening_hours table: live POI search doesn't reliably carry hours data, and
 * guessing "closed" from missing data would wrongly exclude real places.
 */
export function applyMealRules(
  candidates: GraphRankedRestaurant[],
  departureTime: Date
): MealFilteredRestaurant[] {
  return candidates.map((candidate) => {
    const arrivalDate = etaStringToDate(departureTime, candidate.etaArrival);
    return { ...candidate, mealRecommended: mealForArrival(arrivalDate), openAtArrival: null };
  });
}
