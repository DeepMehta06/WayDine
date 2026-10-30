import type { UserPreferences } from "@contract";

const DIET: Record<UserPreferences["diet"], string> = {
  any: "Any food",
  "vegetarian-options": "Has veg options",
  "pure-veg": "Pure veg only",
};

/** One-line human summary, e.g. "Pure veg only · up to 10 min extra · any cuisine · up to ₹400". */
export function describePreferences(p: UserPreferences): string {
  return [
    DIET[p.diet],
    `up to ${p.maxDetourMinutes} min extra`,
    p.cuisines.length ? p.cuisines.join(", ") : "any cuisine",
    p.budgetPerPersonInr ? `up to ₹${p.budgetPerPersonInr.toLocaleString("en-IN")} each` : "no budget limit",
  ].join(" · ");
}

export function dietLabel(d: UserPreferences["diet"]): string {
  return DIET[d];
}
