import type {
  ExcludedRestaurant,
  MealFilteredRestaurant,
  RankedRestaurant,
  RecommendPreferences,
} from "../types/index.js";

const WEIGHTS = {
  detour: 0.45,
  foodMatch: 0.3,
  timing: 0.15,
  proximity: 0.1,
};

const DEFAULT_MAX_DETOUR_MIN = 15;

interface RankResult {
  ranked: RankedRestaurant[];
  excluded: ExcludedRestaurant[];
}

function detourScore(detourMinutes: number, maxDetourMinutes: number): number {
  if (detourMinutes <= 0) return 1;
  return Math.max(0, 1 - detourMinutes / maxDetourMinutes);
}

function foodMatchScore(
  candidate: MealFilteredRestaurant,
  preferences: RecommendPreferences | undefined
): number {
  let score = 1;
  if (preferences?.vegetarian && !candidate.veg_available) score -= 0.6;
  if (preferences?.cuisine && candidate.cuisine !== preferences.cuisine) score -= 0.3;
  return Math.max(0, score);
}

function timingScore(candidate: MealFilteredRestaurant): number {
  // Already filtered to openAtArrival === true by the time this runs; reward
  // a meal-type match (e.g. arriving at lunchtime and it serves lunch) highest.
  return candidate.openAtArrival ? 1 : 0;
}

function proximityScore(distanceFromRoadM: number): number {
  return Math.max(0, 1 - distanceFromRoadM / 200);
}

function buildReason(candidate: MealFilteredRestaurant): string {
  const parts: string[] = [];
  parts.push(candidate.matchesRouteDirection ? "on your driving direction" : "requires crossing traffic");
  parts.push(candidate.openAtArrival ? `open on arrival (${candidate.mealRecommended})` : "closed on arrival");
  parts.push(
    candidate.detourMinutes <= 1
      ? "virtually no detour"
      : `${candidate.detourMinutes} min detour`
  );
  return parts.join(", ");
}

export function excludeAndRank(
  candidates: MealFilteredRestaurant[],
  preferences: RecommendPreferences | undefined
): RankResult {
  const maxDetourMinutes = preferences?.maxDetourMinutes ?? DEFAULT_MAX_DETOUR_MIN;

  const ranked: RankedRestaurant[] = [];
  const excluded: ExcludedRestaurant[] = [];

  for (const candidate of candidates) {
    if (!candidate.matchesRouteDirection) {
      excluded.push({
        id: candidate.id,
        name: candidate.name,
        reason: "On the opposite side of the highway — would require a U-turn",
      });
      continue;
    }
    if (!candidate.openAtArrival) {
      excluded.push({
        id: candidate.id,
        name: candidate.name,
        reason: "Closed at expected arrival time",
      });
      continue;
    }
    if (candidate.detourMinutes > maxDetourMinutes) {
      excluded.push({
        id: candidate.id,
        name: candidate.name,
        reason: `Detour of ${candidate.detourMinutes} min exceeds your ${maxDetourMinutes} min limit`,
      });
      continue;
    }
    if (preferences?.vegetarian && !candidate.veg_available) {
      excluded.push({
        id: candidate.id,
        name: candidate.name,
        reason: "No vegetarian options, and you requested vegetarian-only",
      });
      continue;
    }

    const score =
      WEIGHTS.detour * detourScore(candidate.detourMinutes, maxDetourMinutes) +
      WEIGHTS.foodMatch * foodMatchScore(candidate, preferences) +
      WEIGHTS.timing * timingScore(candidate) +
      WEIGHTS.proximity * proximityScore(candidate.distanceFromRoadM);

    ranked.push({
      ...candidate,
      score: Math.round(score * 100) / 100,
      reason: buildReason(candidate),
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  return { ranked, excluded };
}
