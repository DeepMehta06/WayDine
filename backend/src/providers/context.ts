/** Shared dependencies for provider adapters; swapped for fakes in tests. */
import type { AppConfig } from "../config.js";
import { TtlCache, InFlight, SharedRun } from "../lib/cache.js";
import { QuotaManager } from "../lib/quota.js";
import { createTripGraphLoader, type TripGraphLoader } from "../graph/tripGraph.js";

export interface ProviderContext {
  /** WayDine's own routing engine; absent means Google routing is used for every stage. */
  graph?: { load: TripGraphLoader; crossCheckTop: number };
  geoapifyKey?: string;
  mapboxToken?: string;
  googleRoutesKey?: string;
  routingProvider?: "google" | "mapbox";
  googlePlacesKey?: string;
  googlePlacesEnabled?: boolean;
  restaurantSource?: "legacy" | "google";
  googlePlacesLimits?: { searches: number; details: number; corridorM: number };
  googleMonthlyQuota?: QuotaManager;
  googleInFlight?: SharedRun<unknown>;
  quota: QuotaManager;
  fetchImpl: typeof fetch;
  /** Geoapify responses only (its terms do not restrict caching). */
  geoapifyCache: TtlCache<unknown>;
  inFlight: InFlight<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

export function createProviderContext(config: AppConfig): ProviderContext {
  return {
    graph: config.ROUTING_ENGINE === "graph"
      ? { load: createTripGraphLoader({ source: config.OSM_GRAPH_SOURCE, path: config.OSM_GRAPH_PATH, cacheDir: config.GRAPH_CACHE_DIR, fetchImpl: fetch }), crossCheckTop: config.GRAPH_CROSSCHECK_TOP }
      : undefined,
    geoapifyKey: config.GEOAPIFY_API_KEY,
    // Google Maps cannot display Mapbox search/geocoding features. The legacy
    // browser endpoints use Geoapify for discovery and place search instead.
    mapboxToken: undefined,
    googleRoutesKey: config.GOOGLE_ROUTES_API_KEY,
    routingProvider: "google",
    googlePlacesKey: config.GOOGLE_PLACES_API_KEY,
    googlePlacesEnabled: config.capabilities.googlePlaces,
    restaurantSource: "legacy",
    googlePlacesLimits: { searches: config.GOOGLE_PLACES_SEARCHES_PER_REQUEST, details: config.GOOGLE_PLACES_DETAILS_PER_REQUEST, corridorM: config.GOOGLE_PLACES_CORRIDOR_M },
    googleInFlight: new SharedRun<unknown>(),
    googleMonthlyQuota: new QuotaManager({
      geoapify_credits: 0, mapbox_geocode: 0, mapbox_searchbox: 0, mapbox_directions: 0, mapbox_matrix_elements: 0,
      google_places_nearby: config.GOOGLE_PLACES_NEARBY_PER_MONTH,
      google_places_text_search: config.GOOGLE_PLACES_TEXT_SEARCH_PER_MONTH,
      google_places_details: config.GOOGLE_PLACES_DETAILS_PER_MONTH,
      google_places_photos: config.GOOGLE_PLACES_PHOTOS_PER_MONTH,
    }, config.GOOGLE_PLACES_QUOTA_FILE, () => new Date(), "month"),
    quota: new QuotaManager(
      {
        geoapify_credits: config.BUDGET_GEOAPIFY_CREDITS_PER_DAY,
        mapbox_geocode: config.BUDGET_MAPBOX_GEOCODE_PER_DAY,
        mapbox_searchbox: config.BUDGET_MAPBOX_SEARCHBOX_PER_DAY,
        mapbox_directions: config.BUDGET_MAPBOX_DIRECTIONS_PER_DAY,
        mapbox_matrix_elements: config.BUDGET_MAPBOX_MATRIX_ELEMENTS_PER_DAY,
        google_places_nearby: config.GOOGLE_PLACES_NEARBY_PER_DAY,
        google_places_text_search: config.GOOGLE_PLACES_TEXT_SEARCH_PER_DAY,
        google_places_details: config.GOOGLE_PLACES_DETAILS_PER_DAY,
        google_places_photos: config.GOOGLE_PLACES_PHOTOS_PER_DAY,
        google_routes: config.GOOGLE_ROUTES_PER_DAY,
        google_route_matrix_elements: config.GOOGLE_ROUTE_MATRIX_ELEMENTS_PER_DAY,
      },
      config.QUOTA_STATE_FILE
    ),
    fetchImpl: fetch,
    geoapifyCache: new TtlCache<unknown>(6 * 60 * 60 * 1000, 2000),
    inFlight: new InFlight<unknown>(),
  };
}

/** Rounds coordinates for cache keys so nearby identical queries share entries. */
export function coordKey([lng, lat]: [number, number], decimals = 4): string {
  return `${lng.toFixed(decimals)},${lat.toFixed(decimals)}`;
}
