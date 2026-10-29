/**
 * Preference eligibility. Dietary suitability is taken only from listing
 * tags (OSM diet:vegetarian); names such as "Pure Veg" are never used as
 * evidence. Unknown evidence is excluded unless the user explicitly opts in.
 */
import type { CuisineId, DietPreference, VegetarianEvidence } from "../contract/api.js";
import { cuisineIdsFor } from "../domain/cuisine.js";

export type DietDecision = { eligible: true; unconfirmed: boolean } | { eligible: false; reason: string };

export function dietDecision(evidence: VegetarianEvidence, pref: DietPreference, includeUnconfirmed: boolean): DietDecision {
  if (pref === "any") return { eligible: true, unconfirmed: false };
  if (evidence === "none") return { eligible: false, reason: "Listed as not serving vegetarian food." };
  if (evidence === "unknown") {
    return includeUnconfirmed
      ? { eligible: true, unconfirmed: true }
      : { eligible: false, reason: "No dietary information is listed, so vegetarian options can't be confirmed." };
  }
  if (pref === "pure-veg" && evidence !== "pure-veg") {
    return { eligible: false, reason: "Listed as offering vegetarian options, but not as vegetarian-only." };
  }
  return { eligible: true, unconfirmed: false };
}

export type CuisineDecision = { eligible: true; matched: CuisineId[] } | { eligible: false; reason: string };

export function cuisineDecision(tags: string[], venueType: string | null, wanted: CuisineId[]): CuisineDecision {
  if (wanted.length === 0) return { eligible: true, matched: [] };
  const ids = cuisineIdsFor(tags, venueType);
  const matched = wanted.filter((w) => ids.has(w));
  if (matched.length > 0) return { eligible: true, matched };
  return {
    eligible: false,
    reason:
      tags.length === 0 && !venueType
        ? "Its listing doesn't mention a cuisine."
        : `Listed cuisine (${[...tags, venueType].filter(Boolean).join(", ")}) doesn't match your choice.`,
  };
}
