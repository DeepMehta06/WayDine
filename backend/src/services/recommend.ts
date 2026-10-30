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
  RestaurantProvider as Provider,
  Recommendation,
  RecommendResponse,
  RouteAssessment,
  RoutingSummary,
} from "../contract/api.js";
import { AppError } from "../errors.js";
import { simplifyLine } from "../lib/geo.js";
import { mealPeriodAt, RESTAURANT_TIME_ZONE } from "../lib/time.js";
import type { ProviderContext } from "../providers/context.js";
import { googleDetails } from "../providers/google.js";
import { mapSettled } from "../lib/http.js";
import { positionOnRoute } from "../lib/geo.js";
import { discoverGoogleVenues } from "./googleDiscovery.js";
import { corridorHalfWidthM, discoverVenues, type CorridorVenue } from "./discovery.js";
import { cuisineDecision, dietDecision } from "./eligibility.js";
import { evaluateHours } from "./hours.js";
import { explain, formatMinutes, sortByRankingCost, RANKING_PENALTIES_SEC, type RankInput } from "./ranking.js";
import { directions as getDirections, screenByMatrix, SCREEN_BATCH, verifyStops, type ViaRoute } from "./routing.js";
import { prepareGraphTrip, type GraphStop, type GraphTrip } from "./graphRouting.js";
import { assessRoute } from "./routeEvidence.js";
import { mealRecommendation } from "./meal.js";
import { assessBudget } from "./budget.js";

export const RECOMMEND_LIMITS = {
  screenMax: SCREEN_BATCH * 2,
  verifyMax: 8,
  excludedListMax: 80,
  /** Screening estimates beyond budget*1.5 + 2 min are not worth verifying. */
  screenSlackFactor: 1.5,
  screenSlackSec: 120,
  /** Candidates routed with the graph engine; each needs a snap and two Dijkstra runs (~0.3 s on a 70k-node extract). */
  graphEvalMax: 12,
  /** Reaching a stop by driving this far backward along the route excludes it (graph engine only). */
  graphBackwardExcludeM: 1000,
};

type Verified =
  | { ok: true; via: ViaRoute; assessment?: RouteAssessment; graph?: GraphStop }
  | { ok: false; error: unknown };

export interface RecommendInput {
  source: LngLat;
  destination: LngLat;
  departure: Date;
  preferences: {
    diet: DietPreference;
    includeUnconfirmedDiet: boolean;
    maxDetourMinutes: number;
    cuisines: CuisineId[];
    budgetPerPersonInr?: number | null;
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
): Promise<RecommendResponse<Provider>> {
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
  const directions = await getDirections(ctx, [source, destination], { alternatives: true, steps: true, signal });
  let routeIndex = input.routeIndex ?? 0;
  if (routeIndex >= directions.routes.length) {
    warnings.push("The route option you picked isn't offered any more, so the fastest route was used.");
    routeIndex = 0;
  }
  const baseline = directions.routes[routeIndex]!;
  const geometry = baseline.geometry.coordinates;
  lap("route");

  // 2. Corridor discovery.
  const googleMode = ctx.restaurantSource === "google";
  const halfWidth = googleMode ? (ctx.googlePlacesLimits?.corridorM ?? 200) : corridorHalfWidthM(preferences.maxDetourMinutes);
  const discovery = googleMode ? await discoverGoogleVenues(ctx, geometry, halfWidth, signal) : await discoverVenues(ctx, geometry, halfWidth, signal);
  warnings.push(...discovery.diagnostics.warnings);
  const inCorridor = discovery.venues.length;
  lap("discovery");

  // Google Nearby Search returns identity fields only; Place Details (hours, diet,
  // price, rating) cost more and are capped per request. With Google routing, details
  // are fetched AFTER route screening, for the stops with the least estimated extra
  // time, so the cap never discards places before their access is known. The graph
  // engine path still enriches a route-wide sample first.
  const detailsCap = ctx.googlePlacesLimits?.details ?? 3;
  const deferDetails = googleMode && !ctx.graph;

  const enrichWithDetails = async (venues: CorridorVenue[]): Promise<CorridorVenue[]> => {
    const details = await mapSettled(venues, 2, async (v) => {
      const id = v.sources.find((source) => source.provider === "google")!.id;
      return googleDetails(ctx, id, signal);
    });
    return venues.flatMap((v, index) => {
      const detail = details[index]!;
      if (!detail.ok) {
        if (detail.error instanceof AppError && detail.error.code === "CANCELLED") throw detail.error;
        warnings.push(`Details for ${v.name} could not be retrieved; food, ratings and hours may be unconfirmed.`);
        return [{ ...v, ...(v.google ? { google: { ...v.google, detailsStatus: "unavailable" as const } } : {}) }];
      }
      const fresh = detail.value;
      const pos = positionOnRoute(fresh.location, geometry);
      // Details may correct coordinates or business status. Re-check both before routing.
      if (pos.distanceM > halfWidth || ["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(fresh.google?.businessStatus ?? "")) {
        exclude(v.id, fresh.name, pos.distanceM > halfWidth ? "verification" : "hours", pos.distanceM > halfWidth ? "The listing's updated location is outside the route corridor." : "The business is listed as temporarily or permanently closed.", 2);
        return [];
      }
      return [{ ...v, ...fresh, id: v.id, sources: v.sources, hours: fresh.hours ? [fresh.hours] : [], vegetarianSource: fresh.vegetarian === "unknown" ? null : "google" as const, straightLineFromRouteM: Math.round(pos.distanceM), routePositionM: Math.round(pos.alongM) }];
    });
  };

  let discoveryNotEvaluated = 0;
  if (googleMode && !deferDetails) {
    const shortlist = selectForScreening(discovery.venues, baseline.distance, detailsCap);
    discoveryNotEvaluated = discovery.venues.length - shortlist.length;
    discovery.venues = await enrichWithDetails(shortlist);
    lap("details");
  }

  // 3. Cheap eligibility checks before spending routing quota. `cuisineOnly` is used
  // before Place Details exist; the full check runs again once details are known.
  const assessEligibility = (v: CorridorVenue, cuisineOnly: boolean): Eligible | null => {
    const diet = cuisineOnly ? { eligible: true as const, unconfirmed: false } : dietDecision(v.vegetarian, preferences.diet, preferences.includeUnconfirmedDiet);
    if (!diet.eligible) {
      const notFetched = v.google?.detailsStatus === "not-requested" && v.vegetarian === "unknown";
      exclude(v.id, v.name, "diet", notFetched ? "Its dietary information wasn't loaded within this search's details limit, so vegetarian options can't be confirmed. Include unconfirmed places to see it." : diet.reason, 3);
      return null;
    }
    const cuisine = cuisineDecision(v.cuisineTags, v.venueType, preferences.cuisines);
    if (!cuisine.eligible) {
      exclude(v.id, v.name, "cuisine", cuisine.reason, 3);
      return null;
    }
    if (cuisineOnly) return { venue: v, dietUnconfirmed: false, cuisineMatched: cuisine.matched };
    if (assessBudget(preferences.budgetPerPersonInr, v.google?.priceRange) === "above-range") {
      exclude(v.id, v.name, "budget", `Google's listed typical price range starts above your ₹${preferences.budgetPerPersonInr} per-person budget; individual menu prices may differ.`, 3);
      return null;
    }
    // Pre-check hours only when the place is closed across a +/-20 min window
    // around the estimated pass time, so estimate error can't wrongly exclude it.
    if (v.hours.length > 0 && baseline.distance > 0) {
      const estSec = baseline.duration * (v.routePositionM / baseline.distance);
      const at = (offsetMin: number) => new Date(departure.getTime() + (estSec + offsetMin * 60) * 1000);
      const states = [-20, 0, 20].map((o) => evaluateHours(v.hours, at(o)).atArrival);
      if (states.every((s) => s === "closed")) {
        exclude(v.id, v.name, "hours", `Listed hours show it closed around when you'd pass (about ${arrivalLabel(at(0))}).`, 2);
        return null;
      }
    }
    return { venue: v, dietUnconfirmed: diet.unconfirmed, cuisineMatched: cuisine.matched };
  };

  const eligible: Eligible[] = [];
  for (const v of discovery.venues) {
    const e = assessEligibility(v, deferDetails);
    if (e) eligible.push(e);
  }
  lap("eligibility");

  // 4. Road-graph engine. When configured, WayDine's own Dijkstra over OpenStreetMap data
  // replaces the matrix screening and via-route calls; any failure falls back to Google routing.
  let graphTrip: GraphTrip | null = null;
  let routing: RoutingSummary = { engine: "google" };
  let graphScale = 1;
  if (ctx.graph) {
    try {
      graphTrip = prepareGraphTrip(await ctx.graph.load(geometry, signal), source, destination, geometry);
      // Graph speeds are class-based estimates; scale them so the baseline matches Google's duration.
      graphScale = Math.min(2.5, Math.max(0.4, baseline.duration / graphTrip.baseline.sec));
      routing = {
        engine: "graph",
        graph: {
          nodes: graphTrip.nodes, baselineSec: Math.round(graphTrip.baseline.sec), baselineM: Math.round(graphTrip.baseline.m),
          googleBaselineSec: Math.round(baseline.duration), timeScale: Math.round(graphScale * 100) / 100, warnings: graphTrip.warnings,
        },
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "CANCELLED") throw error;
      const reason = error instanceof AppError ? error.message : "The road graph could not be prepared.";
      routing = { engine: "google", fallbackReason: reason };
      warnings.push(`WayDine's own road-graph routing wasn't used (${reason}) so Google routing was used instead.`);
    }
    lap("graph");
  }

  const selected = selectForScreening(
    eligible.map((e) => ({ ...e, routePositionM: e.venue.routePositionM, straightLineFromRouteM: e.venue.straightLineFromRouteM })),
    baseline.distance,
    graphTrip ? RECOMMEND_LIMITS.graphEvalMax : RECOMMEND_LIMITS.screenMax
  );
  let notEvaluated = discoveryNotEvaluated + eligible.length - selected.length;
  const routedTo = (v: CorridorVenue): LngLat => v.accessPoint ?? v.location;
  let toVerify: Eligible[];
  let verified: Verified[];

  if (graphTrip) {
    const trip = graphTrip;
    const viaFrom = (g: GraphStop): ViaRoute => ({
      durationSec: baseline.duration + g.extraSec * graphScale, distanceM: baseline.distance + g.extraM, toStopSec: g.toStopSec * graphScale,
      geometry: g.geometry, snapDistanceM: g.snapDistanceM, stopOnRoad: g.stopOnRoad, toStopDistanceM: g.toStopM, legs: [],
    });
    toVerify = selected;
    verified = [];
    for (const e of selected) {
      if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
      await new Promise<void>((resolve) => setImmediate(resolve)); // Dijkstra is CPU-bound; let cancellations through.
      const r = trip.evaluate(routedTo(e.venue));
      verified.push(r.ok
        ? { ok: true, via: viaFrom(r.stop), assessment: r.stop.assessment, graph: r.stop }
        : { ok: false, error: new AppError("NO_ROUTE", "No route in the road graph.", { diagnostic: r.reason }) });
    }
    lap("graph-routing");
  } else {
    let shortlist: Array<Eligible & { estimatedExtraSec: number }> = [];
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

    if (deferDetails && shortlist.length > 0) {
      // Spend the Place Details budget on the stops that are actually quickest to reach.
      const byEstimate = [...shortlist].sort((a, b) => a.estimatedExtraSec - b.estimatedExtraSec);
      const toDetail = byEstimate.slice(0, detailsCap).map((e) => e.venue);
      const enriched = new Map((await enrichWithDetails(toDetail)).map((v) => [v.id, v]));
      const detailedIds = new Set(toDetail.map((v) => v.id));
      const next: typeof shortlist = [];
      for (const s of byEstimate) {
        if (detailedIds.has(s.venue.id) && !enriched.has(s.venue.id)) continue; // excluded by details (moved or closed)
        const venue = enriched.get(s.venue.id) ?? s.venue;
        const full = assessEligibility(venue, false);
        if (full) next.push({ ...full, estimatedExtraSec: s.estimatedExtraSec });
      }
      shortlist = next;
      lap("details");
    }

    // 5. Verify the most promising stops as complete journeys.
    const verifyOrder = [...shortlist].sort((a, b) => {
      const penalty = (x: Eligible) =>
        (x.venue.hours.length === 0 ? RANKING_PENALTIES_SEC.hoursUnknown : 0) +
        (x.dietUnconfirmed ? RANKING_PENALTIES_SEC.dietUnconfirmed : 0);
      return a.estimatedExtraSec + penalty(a) - (b.estimatedExtraSec + penalty(b));
    });
    toVerify = verifyOrder.slice(0, RECOMMEND_LIMITS.verifyMax);
    notEvaluated += verifyOrder.length - toVerify.length;
    verified = toVerify.length
      ? await verifyStops(ctx, source, destination, toVerify.map((e) => routedTo(e.venue)), signal)
      : [];
    lap("verification");
  }

  const candidates: Array<RankInput & { rec: Omit<Recommendation<Provider>, "rank"> }> = [];
  verified.forEach((r, i) => {
    const e = toVerify[i]!;
    const v = e.venue;
    if (!r.ok) {
      const err = r.error;
      if (err instanceof AppError && err.code === "NO_ROUTE") {
        const reason = err.diagnostic === "no-road" ? "No drivable road within 75 m of it in the OpenStreetMap data, so a route to it couldn't be calculated."
          : err.diagnostic === "no-path" ? "The OpenStreetMap road graph has no legal path to it from your route."
          : "No drivable route to this place was found.";
        exclude(v.id, v.name, "unreachable", reason, 1);
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
    const mealPeriod = mealPeriodAt(arrival);
    const meal = mealRecommendation(mealPeriod, v.google?.meals, v.cuisineTags, v.venueType, preferences.cuisines);
    if (meal.service === "not-listed") {
      exclude(v.id, v.name, "meal", `The listing indicates this restaurant does not serve ${mealPeriod}${mealPeriod === "breakfast" ? " or brunch" : ""}.`, 2);
      return;
    }
    const basis = v.accessPoint ? "provider-access-point" : "listing-coordinate";
    const confidence = via.snapDistanceM <= (basis === "provider-access-point" || r.graph ? 50 : 35) ? "good" : "uncertain";
    const access = { basis, snapDistanceM: via.snapDistanceM, confidence } as const;
    const routeAssessment = r.assessment ?? assessRoute(geometry, baseline.legs, via, v.location);
    const backwardM = routeAssessment.backwardTravelNearStop.estimatedMetres ?? 0;
    if (r.graph && routeAssessment.backwardTravelNearStop.status === "possible" && backwardM >= RECOMMEND_LIMITS.graphBackwardExcludeM) {
      exclude(v.id, v.name, "detour", `Reaching it means driving about ${backwardM} m backward along your route.`, 0);
      return;
    }
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
    const budget = assessBudget(preferences.budgetPerPersonInr, v.google?.priceRange);
    if (r.graph) facts.push("Route calculated by WayDine's own road graph (Dijkstra over OpenStreetMap data); times are scaled to Google's duration for your route.");
    if (budget === "likely-within") facts.push("Google's typical price range falls within your per-person budget; actual menu prices may differ.");
    else if (budget === "unconfirmed") uncertainties.push("The listed typical price range doesn't confirm whether this stop fits your per-person budget. Check the menu.");
    if (routeAssessment.uTurns.additionalToBaseline === "possible") {
      uncertainties.push("The router reports a U-turn not matched to the selected baseline route. Check the driving directions.");
    } else if (routeAssessment.uTurns.status === "unknown") {
      uncertainties.push("Turn-by-turn information is incomplete, so U-turns could not be assessed.");
    } else if (routeAssessment.uTurns.status === "reported" && routeAssessment.uTurns.additionalToBaseline === "unknown") {
      uncertainties.push("The router reports a U-turn, but it is unclear whether the stop adds it to the selected route.");
    }
    if (routeAssessment.backwardTravelNearStop.status === "possible") {
      uncertainties.push(`The route appears to travel about ${routeAssessment.backwardTravelNearStop.estimatedMetres} m backward along the selected route near this stop. Check the driving directions.`);
    }
    if (routeAssessment.routeDivergence.status === "possible") {
      uncertainties.push("The journey via this stop differs substantially from your selected route; its extra time compares complete journeys and may not describe a local detour.");
    }
    if (v.google) {
      if (meal.service === "listed") facts.push(`Google's listing indicates ${mealPeriod === "snacks" ? "coffee or dessert service" : mealPeriod === "breakfast" ? "breakfast or brunch service" : `${mealPeriod} service`}; specific dishes and availability are not confirmed.`);
      else uncertainties.push(`Food availability around ${mealPeriod} time is unconfirmed.`);
      if (!v.google.businessStatus) uncertainties.push("The listing's current business status is unknown.");
    }
    const rec: Omit<Recommendation<Provider>, "rank"> = {
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
      mealRecommendation: meal,
      budgetAssessment: { status: budget === "above-range" ? "unconfirmed" : budget, budgetPerPersonInr: preferences.budgetPerPersonInr ?? null },
      viaRoute: { geometry: simplifyLine(via.geometry), durationSec: Math.round(via.durationSec), distanceM: Math.round(via.distanceM) },
      facts,
      uncertainties,
      routeAssessment,
      ...(r.graph ? { routing: { engine: "graph" as const, rawExtraSec: Math.round(r.graph.extraSec), uTurns: r.graph.uTurns } } : {}),
      ...(v.google ? { google: v.google } : {}),
    };
    candidates.push({
      id: v.id,
      extraTimeSec: extraSec,
      hours: hours.atArrival,
      closesWithinMinutes: hours.closesWithinMinutes,
      accessConfidence: confidence,
      vegetarian: v.vegetarian,
      straightLineFromRouteM: v.straightLineFromRouteM,
      possibleAdditionalUTurn: routeAssessment.uTurns.additionalToBaseline === "possible",
      possibleBackwardTravel: routeAssessment.backwardTravelNearStop.status === "possible",
      rec,
    });
  });

  const ordered: Recommendation<Provider>[] = sortByRankingCost(candidates, preferences.diet).map((c, i) => ({ ...c.rec, rank: i + 1 }));
  lap("ranking");

  // Google Routes is only a cross-check on the best graph results; its failure never changes the ranking.
  const crossCheckTop = graphTrip ? (ctx.graph?.crossCheckTop ?? 0) : 0;
  if (crossCheckTop > 0 && ordered.length > 0) {
    const top = ordered.slice(0, crossCheckTop);
    const checks = await verifyStops(ctx, source, destination, top.map((rec) => rec.routedTo), signal);
    checks.forEach((check, i) => {
      const rec = top[i]!;
      if (!rec.routing) return;
      if (!check.ok) { rec.routing.crossCheck = { status: "unavailable", googleExtraSec: null, differenceSec: null }; return; }
      const googleExtra = Math.max(0, Math.round(check.via.durationSec - baseline.duration));
      const difference = rec.extraTimeSec - googleExtra;
      const differs = Math.abs(difference) > Math.max(180, 0.5 * Math.max(googleExtra, rec.extraTimeSec));
      rec.routing.crossCheck = { status: differs ? "differs" : "agrees", googleExtraSec: googleExtra, differenceSec: difference };
      if (differs) rec.uncertainties.push(`Google Routes estimates ${formatMinutes(googleExtra)} extra for this stop, against ${formatMinutes(rec.extraTimeSec)} from WayDine's road graph; the OpenStreetMap data may be missing roads or restrictions.`);
    });
    lap("crosscheck");
  }

  if (notEvaluated > 0) {
    warnings.push(
      `${notEvaluated} more place${notEvaluated === 1 ? "" : "s"} along your route ${notEvaluated === 1 ? "wasn't" : "weren't"} checked in detail within this search's configured request limits.`
    );
  }

  const usedProviders = new Set<Provider>();
  for (const v of discovery.venues) for (const s of v.sources) usedProviders.add(s.provider);
  const attribution = ctx.routingProvider === "google" ? [`Powered by Google, ©${new Date().getFullYear()} Google`, "© OpenStreetMap contributors"] : ["© Mapbox", "© OpenStreetMap contributors"];
  if (googleMode) attribution.push("Google Maps");
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
    routing,
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
      inCorridor,
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
