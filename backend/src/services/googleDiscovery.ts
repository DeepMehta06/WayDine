import type { LngLat, ProviderStatus } from "../contract/api.js";
import { AppError } from "../errors.js";
import { cumulativeDistances, positionOnRoute } from "../lib/geo.js";
import { encodePolyline } from "../lib/polyline.js";
import type { ProviderContext } from "../providers/context.js";
import { googleSearchAlongRoute } from "../providers/google.js";
import type { DiscoveryResult } from "./discovery.js";
import { mergeVenues } from "./merge.js";

/** Google's own documented ceiling for Text Search (New): 60 results, 20 per page. */
const GOOGLE_MAX_PAGES = 3;

/**
 * Restaurants along the entire route via Places Text Search (New) with
 * `searchAlongRouteParameters`, replacing the earlier fixed-circle sampling
 * (which left long stretches of a route unsearched between sample points).
 * The corridor half-width is still enforced locally: the API biases toward
 * the route but does not accept an explicit corridor radius.
 */
export async function discoverGoogleVenues(ctx: ProviderContext, route: LngLat[], halfWidthM: number, signal?: AbortSignal): Promise<DiscoveryResult> {
  if (!ctx.googlePlacesEnabled || !ctx.googlePlacesKey) throw new AppError("NOT_CONFIGURED", "Google Places is not enabled.");
  const encoded = encodePolyline(route);
  const maxPages = Math.max(1, Math.min(GOOGLE_MAX_PAGES, ctx.googlePlacesLimits?.searches ?? GOOGLE_MAX_PAGES));

  const pages: Array<{ venues: Awaited<ReturnType<typeof googleSearchAlongRoute>>["venues"]; malformed: number }> = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;
  let failure: unknown;
  let truncatedByPageCap = false;

  for (let i = 0; i < maxPages; i++) {
    try {
      const page = await googleSearchAlongRoute(ctx, encoded, pageToken, signal);
      pages.push({ venues: page.venues, malformed: page.malformed });
      pagesFetched++;
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
      if (i === maxPages - 1) truncatedByPageCap = true;
    } catch (error) {
      if (error instanceof AppError && error.code === "CANCELLED") throw error;
      failure = error;
      break; // Don't keep paginating past a failed page.
    }
  }

  if (pagesFetched === 0) {
    if (failure instanceof AppError) throw failure;
    throw new AppError("UPSTREAM_UNAVAILABLE", "Google restaurant discovery is unavailable.");
  }

  const raw = pages.flatMap((p) => p.venues);
  const merged = mergeVenues(raw);
  const cumulative = cumulativeDistances(route);
  const venues = merged.flatMap((venue) => {
    const pos = positionOnRoute(venue.location, route, cumulative);
    return pos.distanceM <= halfWidthM && !["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(venue.google?.businessStatus ?? "")
      ? [{ ...venue, straightLineFromRouteM: Math.round(pos.distanceM), routePositionM: Math.round(pos.alongM) }]
      : [];
  });

  const warnings: string[] = [];
  if (failure) {
    warnings.push(`Google restaurant search failed while loading page ${pagesFetched + 1} of results along your route; coverage may be incomplete.`);
  }
  if (truncatedByPageCap) {
    warnings.push(`This route has more restaurants than the configured ${maxPages}-page search limit returns; some may be missing.`);
  }
  const status: ProviderStatus = failure ? (failure instanceof AppError && failure.code === "QUOTA_EXCEEDED" ? "quota" : "error") : "ok";

  return {
    venues,
    diagnostics: {
      searchPoints: pagesFetched,
      failedSearchPoints: failure ? 1 : 0,
      saturatedAfterRefinement: truncatedByPageCap ? 1 : 0,
      discovered: { geoapify: 0, mapbox: 0, google: raw.length, merged: merged.length, malformedDropped: pages.reduce((sum, p) => sum + p.malformed, 0) },
      providers: { google: status },
      warnings,
    },
  };
}
