/**
 * Recommendation pipeline:
 *   baseline route -> corridor discovery -> preference eligibility ->
 *   matrix screening (curb approach) -> full via-route verification ->
 *   hours at the verified arrival instant -> transparent ranking.
 * Every exclusion carries a stage and a reason; stages that could not run
 * fully are counted, never silently dropped.
 */
import type {
  CuisineId,
  DietPreference,
  ExcludedPlace,
  ExclusionStage,
  LngLat,
  Provider,
  Recommendation,
  RecommendResponse,
} from "../contract/api.js";
import { AppError } from "../errors.js";
import { simplifyLine } from "../lib/geo.js";
import { mealPeriodAt, RESTAURANT_TIME_ZONE } from "../lib/time.js";
import type { ProviderContext } from "../providers/context.js";
import { mapboxDirections } from "../providers/mapbox.js";
import { corridorHalfWidthM, discoverVenues, type CorridorVenue } from "./discovery.js";
import { cuisineDecision, dietDecision } from "./eligibility.js";
import { evaluateHours } from "./hours.js";
import { explain, formatMinutes, sortByRankingCost, RANKING_PENALTIES_SEC, type RankInput } from "./ranking.js";
import { screenByMatrix, SCREEN_BATCH, verifyStops } from "./routing.js";

export const RECOMMEND_LIMITS = {
  screenMax: SCREEN_BATCH * 2,
  verifyMax: 8,
  excludedListMax: 80,
  /** Screening estimates beyond budget*1.5 + 2 min are not worth verifying. */
  screenSlackFactor: 1.5,
  screenSlackSec: 120,
};

export interface RecommendInput {
  source: LngLat;
  destination: LngLat;
  departure: Date;
  preferences: {
    diet: DietPreference;
    includeUnconfirmedDiet: boolean;
    maxDetourMinutes: number;
    cuisines: CuisineId[];
  };
  routeIndex?: number;
}

const arrivalFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: RESTAURANT_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function arrivalLabel(instant: Date): string {
  return `${arrivalFormatter.format(instant)} IST`;
}

/** Spreads screening slots along the route so one dense area can't consume all of them. */
export function selectForScreening<T extends { routePositionM: number; straightLineFromRouteM: number }>(
  items: T[],
  routeLengthM: number,
  max: number,
  buckets = 6
): T[] {
  if (items.length <= max) return items;
  const lanes: T[][] = Array.from({ length: buckets }, () => []);
  for (const item of items) {
    const b = Math.min(buckets - 1, Math.floor((item.routePositionM / Math.max(routeLengthM, 1)) * buckets));
    lanes[b]!.push(item);
  }
  lanes.forEach((lane) => lane.sort((a, b) => a.straightLineFromRouteM - b.straightLineFromRouteM));
  const out: T[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const lane of lanes) {
      const item = lane[round];
      if (item) {
        out.push(item);
        added = true;
        if (out.length >= max) break;
      }
    }
    if (!added) break;
  }
  return out;
}

interface Eligible {
  venue: CorridorVenue;
  dietUnconfirmed: boolean;
  cuisineMatched: CuisineId[];
}

export async function recommend(
  ctx: ProviderContext,
  input: RecommendInput,
  requestId: string,
  signal?: AbortSignal,
  now: () => number = Date.now
): Promise<RecommendResponse> {
  const stageMs: Record<string, number> = {};
  const warnings: string[] = [];
  const excluded: Array<ExcludedPlace & { order: number }> = [];
  const excludedByStage: Partial<Record<ExclusionStage, number>> = {};
  const exclude = (id: string, name: string, stage: ExclusionStage, reason: string, order = 0) => {
    excluded.push({ id, name, stage, reason, order });
    excludedByStage[stage] = (excludedByStage[stage] ?? 0) + 1;
  };
  const { source, destination, departure, preferences } = input;
  const budgetSec = preferences.maxDetourMinutes * 60;
  let t = now();
  const lap = (name: string) => {
    const n = now();
    stageMs[name] = n - t;
    t = n;
  };

  // 1. Baseline route (explicitly selected among the offered alternatives).
  const directions = await mapboxDirections(ctx, [source, destination], { alternatives: true, signal });
  let routeIndex = input.routeIndex ?? 0;
  if (routeIndex >= directions.routes.length) {
    warnings.push("The route option you picked isn't offered any more, so the fastest route was used.");
    routeIndex = 0;
  }
  const baseline = directions.routes[routeIndex]!;
  const geometry = baseline.geometry.coordinates;
  lap("route");

  // 2. Corridor discovery.
  const halfWidth = corridorHalfWidthM(preferences.maxDetourMinutes);
  const discovery = await discoverVenues(ctx, geometry, halfWidth, signal);
  warnings.push(...discovery.diagnostics.warnings);
  lap("discovery");

  // 3. Cheap eligibility checks before spending routing quota.
  const eligible: Eligible[] = [];
  for (const v of discovery.venues) {
    const diet = dietDecision(v.vegetarian, preferences.diet, preferences.includeUnconfirmedDiet);
    if (!diet.eligible) {
      exclude(v.id, v.name, "diet", diet.reason, 3);
      continue;
    }
    const cuisine = cuisineDecision(v.cuisineTags, v.venueType, preferences.cuisines);
    if (!cuisine.eligible) {
      exclude(v.id, v.name, "cuisine", cuisine.reason, 3);
      continue;
    }
    // Pre-check hours only when the place is closed across a +/-20 min window
    // around the estimated pass time, so estimate error can't wrongly exclude it.
    if (v.hours.length > 0 && baseline.distance > 0) {
      const estSec = baseline.duration * (v.routePositionM / baseline.distance);
      const at = (offsetMin: number) => new Date(departure.getTime() + (estSec + offsetMin * 60) * 1000);
      const states = [-20, 0, 20].map((o) => evaluateHours(v.hours, at(o)).atArrival);
      if (states.every((s) => s === "closed")) {
        exclude(v.id, v.name, "hours", `Listed hours show it closed around when you'd pass (about ${arrivalLabel(at(0))}).`, 2);
        continue;
      }
    }
    eligible.push({ venue: v, dietUnconfirmed: diet.unconfirmed, cuisineMatched: cuisine.matched });
  }
  lap("eligibility");

  // 4. Screening with access-aware travel-time estimates.
  const selected = selectForScreening(
    eligible.map((e) => ({ ...e, routePositionM: e.venue.routePositionM, straightLineFromRouteM: e.venue.straightLineFromRouteM })),
    baseline.distance,
    RECOMMEND_LIMITS.screenMax
  );
  let notEvaluated = eligible.length - selected.length;
  const routedTo = (v: CorridorVenue): LngLat => v.accessPoint ?? v.location;
  const shortlist: Array<Eligible & { estimatedExtraSec: number }> = [];
  if (selected.length > 0) {
    const { screened } = await screenByMatrix(ctx, source, destination, selected.map((e) => routedTo(e.venue)), signal);
    for (const s of screened) {
      const e = selected[s.index]!;
      if (s.estimatedExtraSec === null) {
        exclude(e.venue.id, e.venue.name, "unreachable", "No drivable route to this place was found from your route.", 1);
      } else if (s.estimatedExtraSec > budgetSec * RECOMMEND_LIMITS.screenSlackFactor + RECOMMEND_LIMITS.screenSlackSec) {
        exclude(
          e.venue.id,
          e.venue.name,
          "detour",
          `Estimated to add about ${formatMinutes(s.estimatedExtraSec)} of driving (your limit is ${preferences.maxDetourMinutes} min).`,
          0
        );
      } else {
        shortlist.push({ ...e, estimatedExtraSec: s.estimatedExtraSec });
      }
    }
  }
  lap("screening");

  // 5. Verify the most promising stops as complete journeys.
  const verifyOrder = [...shortlist].sort((a, b) => {
    const penalty = (x: Eligible) =>
      (x.venue.hours.length === 0 ? RANKING_PENALTIES_SEC.hoursUnknown : 0) +
      (x.dietUnconfirmed ? RANKING_PENALTIES_SEC.dietUnconfirmed : 0);
    return a.estimatedExtraSec + penalty(a) - (b.estimatedExtraSec + penalty(b));
  });
  const toVerify = verifyOrder.slice(0, RECOMMEND_LIMITS.verifyMax);
  notEvaluated += verifyOrder.length - toVerify.length;
  const verified = toVerify.length
    ? await verifyStops(ctx, source, destination, toVerify.map((e) => routedTo(e.venue)), signal)
    : [];
  lap("verification");

  const candidates: Array<RankInput & { rec: Omit<Recommendation, "rank"> }> = [];
  verified.forEach((r, i) => {
    const e = toVerify[i]!;
    const v = e.venue;
    if (!r.ok) {
      const err = r.error;
      if (err instanceof AppError && err.code === "NO_ROUTE") {
        exclude(v.id, v.name, "unreachable", "No drivable route to this place was found.", 1);
      } else if (err instanceof AppError && err.code === "QUOTA_EXCEEDED") {
        exclude(v.id, v.name, "verification", "Today's free routing allowance ran out before this place could be checked.", 4);
      } else {
        exclude(v.id, v.name, "verification", "Couldn't check driving access to this place right now.", 4);
      }
      return;
    }
    const via = r.via;
    const extraSec = Math.round(via.durationSec - baseline.duration);
    if (extraSec > budgetSec) {
      exclude(
        v.id,
        v.name,
        "detour",
        `Adds about ${formatMinutes(extraSec)} of driving when routed to its entrance (your limit is ${preferences.maxDetourMinutes} min).`,
        0
      );
      return;
    }
    const arrival = new Date(departure.getTime() + via.toStopSec * 1000);
    const hours = evaluateHours(v.hours, arrival);
    if (hours.atArrival === "closed") {
      exclude(v.id, v.name, "hours", `Listed hours show it closed when you'd arrive (${arrivalLabel(arrival)}).`, 2);
      return;
    }
    const basis = v.accessPoint ? "provider-access-point" : "listing-coordinate";
    const confidence = via.snapDistanceM <= (basis === "provider-access-point" ? 50 : 35) ? "good" : "uncertain";
    const access = { basis, snapDistanceM: via.snapDistanceM, confidence } as const;
    const mealPeriod = mealPeriodAt(arrival);
    const { facts, uncertainties } = explain({
      extraTimeSec: extraSec,
      arrivalLabel: arrivalLabel(arrival),
      hours,
      vegetarian: v.vegetarian,
      vegetarianSource: v.vegetarianSource,
      diet: preferences.diet,
      access,
      mealPeriod,
      cuisineMatched: e.cuisineMatched,
    });
    const rec: Omit<Recommendation, "rank"> = {
      id: v.id,
      name: v.name,
      venueType: v.venueType,
      cuisines: v.cuisineTags,
      location: v.location,
      routedTo: routedTo(v),
      address: v.address,
      phone: v.phone,
      website: v.website,
      sources: v.sources,
      arrivalTime: arrival.toISOString(),
      extraTimeSec: Math.max(0, extraSec),
      extraDistanceM: Math.max(0, Math.round(via.distanceM - baseline.distance)),
      destinationArrivalTime: new Date(departure.getTime() + via.durationSec * 1000).toISOString(),
      straightLineFromRouteM: v.straightLineFromRouteM,
      routePositionM: v.routePositionM,
      access,
      openingHours: {
        atArrival: hours.atArrival,
        closesWithinMinutes: hours.closesWithinMinutes,
        source: hours.source,
        text: hours.text,
      },
      diet: { vegetarian: v.vegetarian, source: v.vegetarianSource },
      mealPeriod,
      viaRoute: { geometry: simplifyLine(via.geometry), durationSec: Math.round(via.durationSec), distanceM: Math.round(via.distanceM) },
      facts,
      uncertainties,
    };
    candidates.push({
      id: v.id,
      extraTimeSec: extraSec,
      hours: hours.atArrival,
      closesWithinMinutes: hours.closesWithinMinutes,
      accessConfidence: confidence,
      vegetarian: v.vegetarian,
      straightLineFromRouteM: v.straightLineFromRouteM,
      rec,
    });
  });

  const ordered: Recommendation[] = sortByRankingCost(candidates, preferences.diet).map((c, i) => ({ ...c.rec, rank: i + 1 }));
  lap("ranking");

  if (notEvaluated > 0) {
    warnings.push(
      `${notEvaluated} more place${notEvaluated === 1 ? "" : "s"} along your route ${notEvaluated === 1 ? "wasn't" : "weren't"} checked in detail because each search has a fixed free routing budget.`
    );
  }

  const usedProviders = new Set<Provider>();
  for (const v of discovery.venues) for (const s of v.sources) usedProviders.add(s.provider);
  const attribution = ["© Mapbox", "© OpenStreetMap contributors"];
  if (usedProviders.has("geoapify") || discovery.diagnostics.providers.geoapify === "ok") attribution.push("Powered by Geoapify");

  const departureIso = departure.toISOString();
  return {
    requestId,
    timeZone: "Asia/Kolkata",
    route: {
      index: routeIndex,
      geometry: simplifyLine(geometry),
      durationSec: Math.round(baseline.duration),
      distanceM: Math.round(baseline.distance),
      summary: baseline.legs[0]?.summary ?? "",
      departureTime: departureIso,
      arrivalTime: new Date(departure.getTime() + baseline.duration * 1000).toISOString(),
      alternatives: directions.routes.map((r, i) => ({
        index: i,
        durationSec: Math.round(r.duration),
        distanceM: Math.round(r.distance),
        summary: r.legs[0]?.summary ?? "",
      })),
    },
    recommendations: ordered,
    excluded: excluded
      .sort((a, b) => a.order - b.order)
      .slice(0, RECOMMEND_LIMITS.excludedListMax)
      .map(({ order: _o, ...rest }) => rest),
    diagnostics: {
      corridorHalfWidthM: halfWidth,
      searchAreas: {
        total: discovery.diagnostics.searchPoints,
        failed: discovery.diagnostics.failedSearchPoints,
        truncated: discovery.diagnostics.saturatedAfterRefinement,
      },
      discovered: discovery.diagnostics.discovered,
      inCorridor: discovery.venues.length,
      screened: selected.length,
      verified: verified.filter((r) => r.ok).length,
      notEvaluated,
      excludedByStage,
      providers: discovery.diagnostics.providers,
      stageMs,
      warnings,
    },
    attribution,
  };
}
