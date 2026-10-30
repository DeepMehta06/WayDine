import type { LngLat, ProviderStatus } from "../contract/api.js";
import { AppError } from "../errors.js";
import { cumulativeDistances, planCorridorSearch, positionOnRoute } from "../lib/geo.js";
import { mapSettled } from "../lib/http.js";
import type { ProviderContext } from "../providers/context.js";
import { googleNearby } from "../providers/google.js";
import type { DiscoveryResult } from "./discovery.js";
import { mergeVenues } from "./merge.js";

export async function discoverGoogleVenues(ctx: ProviderContext, route: LngLat[], halfWidthM: number, signal?: AbortSignal): Promise<DiscoveryResult> {
  if (!ctx.googlePlacesEnabled || !ctx.googlePlacesKey) throw new AppError("NOT_CONFIGURED", "Google Places is not enabled.");
  const plan = planCorridorSearch(route, halfWidthM, ctx.googlePlacesLimits?.searches ?? 3);
  // Reject before spending requests if the route cannot fit Google's maximum radius.
  if (plan.radiusM > 50000) throw new AppError("BAD_REQUEST", "This route exceeds the configured Google search coverage. Increase the search-area budget or use a shorter route.");
  const results = await mapSettled(plan.centers, 2, (center) => googleNearby(ctx, center, plan.radiusM, signal));
  for (const result of results) if (!result.ok && result.error instanceof AppError && result.error.code === "CANCELLED") throw result.error;
  const successful = results.filter((r) => r.ok);
  const failed = results.length - successful.length;
  const firstError = results.find((r) => !r.ok);
  if (!successful.length) {
    if (firstError && !firstError.ok && firstError.error instanceof AppError) throw firstError.error;
    throw new AppError("UPSTREAM_UNAVAILABLE", "Google restaurant discovery is unavailable.");
  }
  const raw = successful.flatMap((r) => r.value.venues);
  const merged = mergeVenues(raw);
  const cumulative = cumulativeDistances(route);
  const venues = merged.flatMap((venue) => {
    const pos = positionOnRoute(venue.location, route, cumulative);
    return pos.distanceM <= halfWidthM && !["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(venue.google?.businessStatus ?? "")
      ? [{ ...venue, straightLineFromRouteM: Math.round(pos.distanceM), routePositionM: Math.round(pos.alongM) }]
      : [];
  });
  const saturated = successful.filter((r) => r.value.saturated).length;
  const warnings: string[] = [];
  if (failed) warnings.push(`Google restaurant search failed in ${failed} of ${results.length} search areas; coverage is incomplete.`);
  if (saturated) warnings.push(`${saturated} Google search areas reached the 20-result limit. Some restaurants may be missing; no automatic extra searches were made.`);
  const status: ProviderStatus = failed ? results.some((r) => !r.ok && r.error instanceof AppError && r.error.code === "QUOTA_EXCEEDED") ? "quota" : "error" : "ok";
  return { venues, diagnostics: {
    searchPoints: results.length, failedSearchPoints: failed, saturatedAfterRefinement: saturated,
    discovered: { geoapify: 0, mapbox: 0, google: raw.length, merged: merged.length, malformedDropped: successful.reduce((sum, r) => sum + r.value.malformed, 0) },
    providers: { google: status }, warnings,
  } };
}
