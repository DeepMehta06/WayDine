/**
 * Transparent ranking. A stop's ranking cost is its routed extra travel time
 * plus fixed, documented penalties for missing evidence. No percentage or
 * "match" score is produced: there is no calibrated quality signal (neither
 * data source supplies ratings or reviews), so none is implied.
 */
import type { DietPreference, MealPeriod, Provider, VegetarianEvidence } from "../contract/api.js";

export const RANKING_PENALTIES_SEC = {
  hoursUnknown: 180,
  accessUncertain: 120,
  dietUnconfirmed: 240,
  closesWithin30Min: 300,
} as const;

export interface RankInput {
  id: string;
  extraTimeSec: number;
  hours: "open" | "closed" | "unknown";
  closesWithinMinutes: number | null;
  accessConfidence: "good" | "uncertain";
  vegetarian: VegetarianEvidence;
  straightLineFromRouteM: number;
}

export function rankingCostSec(input: RankInput, diet: DietPreference): number {
  let cost = Math.max(0, input.extraTimeSec);
  if (input.hours === "unknown") cost += RANKING_PENALTIES_SEC.hoursUnknown;
  if (input.closesWithinMinutes !== null && input.closesWithinMinutes <= 30) cost += RANKING_PENALTIES_SEC.closesWithin30Min;
  if (input.accessConfidence === "uncertain") cost += RANKING_PENALTIES_SEC.accessUncertain;
  if (diet !== "any" && input.vegetarian === "unknown") cost += RANKING_PENALTIES_SEC.dietUnconfirmed;
  return cost;
}

export function sortByRankingCost<T extends RankInput>(items: T[], diet: DietPreference): T[] {
  return [...items].sort(
    (a, b) =>
      rankingCostSec(a, diet) - rankingCostSec(b, diet) ||
      a.extraTimeSec - b.extraTimeSec ||
      a.straightLineFromRouteM - b.straightLineFromRouteM ||
      a.id.localeCompare(b.id)
  );
}

const PROVIDER_LABEL: Record<Provider, string> = {
  geoapify: "OpenStreetMap (via Geoapify)",
  mapbox: "Mapbox",
};

export function formatMinutes(sec: number): string {
  const m = Math.round(Math.max(0, sec) / 60);
  return m === 0 ? "under a minute" : `${m} min`;
}

export interface ExplainInput {
  extraTimeSec: number;
  arrivalLabel: string;
  hours: { atArrival: "open" | "closed" | "unknown"; closesWithinMinutes: number | null; source: Provider | null; conflict: boolean };
  vegetarian: VegetarianEvidence;
  vegetarianSource: Provider | null;
  diet: DietPreference;
  access: { basis: "provider-access-point" | "listing-coordinate"; snapDistanceM: number; confidence: "good" | "uncertain" };
  mealPeriod: MealPeriod;
  cuisineMatched: string[];
}

export function explain(input: ExplainInput): { facts: string[]; uncertainties: string[] } {
  const facts: string[] = [];
  const uncertainties: string[] = [];

  facts.push(
    input.extraTimeSec <= 30
      ? "Routing shows no meaningful extra driving time for this stop."
      : `Adds about ${formatMinutes(input.extraTimeSec)} of driving compared with your route.`
  );

  if (input.hours.atArrival === "open") {
    facts.push(`Listed hours (${PROVIDER_LABEL[input.hours.source!]}) show it open when you arrive, ${input.arrivalLabel}.`);
    if (input.hours.closesWithinMinutes !== null) {
      uncertainties.push(`Listed hours show it closing about ${input.hours.closesWithinMinutes} min after you arrive.`);
    }
  } else if (input.hours.conflict) {
    uncertainties.push("Its listings disagree about opening hours, so whether it is open on arrival is unknown.");
  } else {
    uncertainties.push("Opening hours are not listed, so it may be closed when you arrive.");
  }

  if (input.vegetarian === "pure-veg") {
    facts.push(`Listed as vegetarian-only by ${PROVIDER_LABEL[input.vegetarianSource!]}.`);
  } else if (input.vegetarian === "options") {
    facts.push(`Listed as offering vegetarian food by ${PROVIDER_LABEL[input.vegetarianSource!]}.`);
  } else if (input.diet !== "any") {
    uncertainties.push("No dietary information is listed; vegetarian options are unconfirmed.");
  }

  if (input.cuisineMatched.length) facts.push(`Listed cuisine matches your choice: ${input.cuisineMatched.join(", ")}.`);

  if (input.access.confidence === "good") {
    facts.push(
      input.access.basis === "provider-access-point"
        ? "The route reaches the listing's access point on your side of the road."
        : "The route reaches the road right next to the listed location."
    );
  } else {
    uncertainties.push(
      `The nearest drivable point found is about ${input.access.snapDistanceM} m from the ${
        input.access.basis === "provider-access-point" ? "listed access point" : "listed location"
      }; the entrance may be elsewhere.`
    );
  }

  facts.push(`You'd arrive around ${input.mealPeriod === "late night" ? "late night" : `${input.mealPeriod} time`}. That's the time of day, not a menu guarantee.`);
  return { facts, uncertainties };
}
