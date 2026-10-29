/**
 * Route-wide restaurant discovery. Both providers are queried at circles that
 * cover the whole corridor; saturated areas are refined within a budget;
 * individual failures degrade to partial results instead of failing the trip.
 */
import type { LngLat, Provider, ProviderStatus } from "../contract/api.js";
import type { MergedVenue, Venue } from "../domain/venue.js";
import { AppError } from "../errors.js";
import {
  bboxAround,
  cumulativeDistances,
  planCorridorSearch,
  positionOnRoute,
  quadrants,
  type BBox,
} from "../lib/geo.js";
import { mapSettled } from "../lib/http.js";
import { log } from "../lib/log.js";
import type { ProviderContext } from "../providers/context.js";
import { geoapifyPlaces, GEOAPIFY_PLACES_LIMIT } from "../providers/geoapify.js";
import { mapboxFoodCategory } from "../providers/mapbox.js";
import { mergeVenues } from "./merge.js";

export const DISCOVERY_LIMITS = {
  maxInitialAreas: 10,
  maxMapboxRefinements: 8,
  maxGeoapifyExtraPages: 6,
  concurrency: 4,
};

/**
 * Documented product constraint: places farther than this straight-line
 * distance from the route are not searched. At urban speeds a there-and-back
 * diversion of 100 m per minute of detour budget is already optimistic, so
 * farther places would almost never fit the budget. Inclusion is still decided
 * by routed extra time, not by this distance.
 */
export function corridorHalfWidthM(maxDetourMinutes: number): number {
  return Math.round(Math.min(1500, Math.max(300, maxDetourMinutes * 100)));
}

export interface CorridorVenue extends MergedVenue {
  straightLineFromRouteM: number;
  routePositionM: number;
}

export interface DiscoveryResult {
  venues: CorridorVenue[];
  diagnostics: {
    searchPoints: number;
    failedSearchPoints: number;
    saturatedAfterRefinement: number;
    discovered: { geoapify: number; mapbox: number; merged: number; malformedDropped: number };
    providers: Partial<Record<Provider, ProviderStatus>>;
    warnings: string[];
  };
}

interface AreaResult {
  provider: Provider;
  ok: boolean;
  saturated: boolean;
  venues: Venue[];
  malformed: number;
  error?: unknown;
}

function failureStatus(err: unknown): ProviderStatus {
  if (err instanceof AppError && err.code === "QUOTA_EXCEEDED") return "quota";
  return "error";
}

export async function discoverVenues(
  ctx: ProviderContext,
  route: LngLat[],
  halfWidthM: number,
  signal?: AbortSignal
): Promise<DiscoveryResult> {
  const plan = planCorridorSearch(route, halfWidthM, DISCOVERY_LIMITS.maxInitialAreas);
  const providers: DiscoveryResult["diagnostics"]["providers"] = {};
  const useGeoapify = Boolean(ctx.geoapifyKey);
  const useMapbox = Boolean(ctx.mapboxToken);
  if (!useGeoapify) providers.geoapify = "disabled";
  if (!useMapbox) providers.mapbox = "disabled";

  type Job = { provider: Provider; run: () => Promise<{ venues: Venue[]; malformed: number; saturated: boolean }>; area: number; refine?: () => Job[] };
  const jobsFor = (area: number): Job[] => {
    const center = plan.centers[area]!;
    const bbox = bboxAround(center, plan.radiusM);
    const out: Job[] = [];
    if (useGeoapify) {
      out.push({
        provider: "geoapify",
        area,
        run: () => geoapifyPlaces(ctx, center, plan.radiusM, 0, signal),
        refine: () => [
          {
            provider: "geoapify",
            area,
            run: () => geoapifyPlaces(ctx, center, plan.radiusM, GEOAPIFY_PLACES_LIMIT, signal),
          },
        ],
      });
    }
    if (useMapbox) {
      out.push({
        provider: "mapbox",
        area,
        run: () => mapboxFoodCategory(ctx, bbox, signal),
        refine: () =>
          quadrants(bbox).map((q: BBox) => ({ provider: "mapbox" as const, area, run: () => mapboxFoodCategory(ctx, q, signal) })),
      });
    }
    return out;
  };

  const runJobs = async (jobs: Job[]): Promise<Array<AreaResult & { job: Job }>> => {
    const settled = await mapSettled(jobs, DISCOVERY_LIMITS.concurrency, (j) => j.run());
    return settled.map((r, i) => {
      const job = jobs[i]!;
      if (r.ok) return { job, provider: job.provider, ok: true, saturated: r.value.saturated, venues: r.value.venues, malformed: r.value.malformed };
      if (r.error instanceof AppError && r.error.code === "CANCELLED") throw r.error;
      return { job, provider: job.provider, ok: false, saturated: false, venues: [], malformed: 0, error: r.error };
    });
  };

  const initialJobs = plan.centers.flatMap((_, area) => jobsFor(area));
  const initial = await runJobs(initialJobs);

  // Refinement: spend a bounded budget on areas that returned a full page.
  const saturated = initial.filter((r) => r.ok && r.saturated && r.job.refine);
  const refineGeo = saturated.filter((r) => r.provider === "geoapify").slice(0, DISCOVERY_LIMITS.maxGeoapifyExtraPages);
  const mapboxBudgetAreas = Math.floor(DISCOVERY_LIMITS.maxMapboxRefinements / 4);
  const refineMbx = saturated.filter((r) => r.provider === "mapbox").slice(0, mapboxBudgetAreas);
  const refinementJobs = [...refineGeo, ...refineMbx].flatMap((r) => r.job.refine!());
  const refined = refinementJobs.length ? await runJobs(refinementJobs) : [];

  const all = [...initial, ...refined];
  const discovered = { geoapify: 0, mapbox: 0, merged: 0, malformedDropped: 0 };
  const rawVenues: Venue[] = [];
  const failuresByProvider: Record<string, number> = {};
  const okByProvider: Record<string, number> = {};
  const failedAreas = new Set<number>();
  for (const r of all) {
    if (r.ok) {
      okByProvider[r.provider] = (okByProvider[r.provider] ?? 0) + 1;
      discovered[r.provider] += r.venues.length;
      discovered.malformedDropped += r.malformed;
      rawVenues.push(...r.venues);
    } else {
      failuresByProvider[r.provider] = (failuresByProvider[r.provider] ?? 0) + 1;
      providers[r.provider] = failureStatus(r.error);
      failedAreas.add(r.job.area);
      log("warn", "discovery.area_failed", { provider: r.provider, code: (r.error as AppError)?.code });
    }
  }
  for (const p of ["geoapify", "mapbox"] as const) {
    if (okByProvider[p] && !failuresByProvider[p]) providers[p] = "ok";
  }

  const anySuccess = Object.values(okByProvider).some((n) => n > 0);
  if (!anySuccess && initialJobs.length > 0) {
    const allQuota = all.every((r) => r.error instanceof AppError && r.error.code === "QUOTA_EXCEEDED");
    throw allQuota
      ? new AppError("QUOTA_EXCEEDED", "Today's free allowance for restaurant search has been used up. Please try again tomorrow.")
      : new AppError("UPSTREAM_UNAVAILABLE", "Restaurant search is unavailable right now. Please try again.");
  }

  // An area counts as still saturated if any provider's last page there was full.
  const refinedAreaProviders = new Set(refinementJobs.map((j) => `${j.provider}:${j.area}`));
  const stillSaturated = new Set<number>();
  for (const r of initial) {
    if (r.ok && r.saturated && !refinedAreaProviders.has(`${r.provider}:${r.job.area}`)) stillSaturated.add(r.job.area);
  }
  for (const r of refined) if (r.ok && r.saturated) stillSaturated.add(r.job.area);

  const merged = mergeVenues(rawVenues);
  discovered.merged = merged.length;

  const cumulative = cumulativeDistances(route);
  const venues: CorridorVenue[] = [];
  for (const v of merged) {
    const pos = positionOnRoute(v.location, route, cumulative);
    if (pos.distanceM > halfWidthM) continue;
    venues.push({ ...v, straightLineFromRouteM: Math.round(pos.distanceM), routePositionM: Math.round(pos.alongM) });
  }

  const warnings: string[] = [];
  if (failedAreas.size > 0) {
    warnings.push(
      `Restaurant search failed for ${failedAreas.size} of ${plan.centers.length} stretches of your route; results there may be incomplete.`
    );
  }
  if (stillSaturated.size > 0) {
    warnings.push(
      `${stillSaturated.size} busy stretch${stillSaturated.size === 1 ? "" : "es"} of your route had more restaurants than our free data sources return in one search, so some places there were not considered.`
    );
  }
  const quotaProviders = Object.entries(providers).filter(([, s]) => s === "quota").map(([p]) => p);
  if (quotaProviders.length) {
    warnings.push(`Today's free search allowance is used up for ${quotaProviders.join(" and ")}; results come from the remaining source only.`);
  }

  return {
    venues,
    diagnostics: {
      searchPoints: plan.centers.length,
      failedSearchPoints: failedAreas.size,
      saturatedAfterRefinement: stillSaturated.size,
      discovered,
      providers,
      warnings,
    },
  };
}
