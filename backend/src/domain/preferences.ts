import { z } from "zod";
import { CUISINE_OPTIONS, type UserPreferences } from "../contract/api.js";

export function defaultUserPreferences(): UserPreferences {
  return { diet: "any", cuisines: [], includeUnconfirmedDiet: false, maxDetourMinutes: 10, budgetPerPersonInr: null };
}

export const userPreferencesSchema = z.object({
  diet: z.enum(["any", "vegetarian-options", "pure-veg"]),
  cuisines: z.array(z.enum(CUISINE_OPTIONS)).max(CUISINE_OPTIONS.length).transform((items) => [...new Set(items)]),
  includeUnconfirmedDiet: z.boolean(),
  maxDetourMinutes: z.number().int().min(1).max(60),
  budgetPerPersonInr: z.number().int().min(1).max(100000).nullable(),
}).strict() satisfies z.ZodType<UserPreferences>;

export const userPreferencesPatchSchema = userPreferencesSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: "Provide at least one preference to update." },
);
