import type { CuisineId, GoogleRestaurantDetails, MealPeriod, MealRecommendation } from "../contract/api.js";
import { cuisineIdsFor } from "../domain/cuisine.js";

type MealFlags = GoogleRestaurantDetails["meals"];

/** A negative snack or late-night result cannot be inferred from coffee/dessert flags. */
export function mealService(period: MealPeriod, flags?: MealFlags): MealRecommendation["service"] {
  if (!flags || period === "late night") return "unknown";
  if (period === "snacks") return flags.coffee === true || flags.dessert === true ? "listed" : "unknown";
  if (period === "breakfast") {
    if (flags.breakfast === true || flags.brunch === true) return "listed";
    return flags.breakfast === false && flags.brunch === false ? "not-listed" : "unknown";
  }
  return flags[period] === true ? "listed" : flags[period] === false ? "not-listed" : "unknown";
}

const IDEAS: Partial<Record<CuisineId, Partial<Record<MealPeriod, string[]>>>> = {
  "south indian": { breakfast: ["Idli", "Dosa"], lunch: ["Dosa"], dinner: ["Dosa"] },
  "north indian": { breakfast: ["Paratha"], lunch: ["Dal and roti"], dinner: ["Dal and roti"] },
  maharashtrian: { breakfast: ["Poha"], snacks: ["Vada pav"] },
  gujarati: { breakfast: ["Dhokla"], snacks: ["Dhokla"] },
  "street food": { snacks: ["Vada pav", "Pav bhaji"] },
};

/** Ideas are not menu data. Only use a cuisine the venue lists and the user accepts. */
export function mealRecommendation(period: MealPeriod, flags: MealFlags | undefined, tags: string[], venueType: string | null, preferences: CuisineId[]): MealRecommendation {
  const listed = cuisineIdsFor(tags, venueType);
  const cuisines = preferences.length ? preferences.filter((id) => listed.has(id)) : [...listed];
  const ideas = cuisines.flatMap((cuisine) => IDEAS[cuisine]?.[period] ?? []);
  if (period === "snacks" && flags?.coffee === true && (!preferences.length || preferences.includes("cafe"))) ideas.push("Coffee");
  if (period === "snacks" && flags?.dessert === true && (!preferences.length || preferences.includes("dessert"))) ideas.push("Dessert");
  return {
    service: mealService(period, flags),
    ideas: [...new Set(ideas)].slice(0, 4),
    disclaimer: "Ideas are based on meal time and listed cuisine; dishes, ingredients and availability are not verified. Check the menu with the restaurant.",
  };
}
