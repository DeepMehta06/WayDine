/** Shared dependencies for provider adapters; swapped for fakes in tests. */
import type { AppConfig } from "../config.js";
import { TtlCache, InFlight } from "../lib/cache.js";
import { QuotaManager } from "../lib/quota.js";

export interface ProviderContext {
  geoapifyKey?: string;
  mapboxToken?: string;
  quota: QuotaManager;
  fetchImpl: typeof fetch;
  /** Geoapify responses only (its terms do not restrict caching). */
  geoapifyCache: TtlCache<unknown>;
  inFlight: InFlight<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

export function createProviderContext(config: AppConfig): ProviderContext {
  return {
    geoapifyKey: config.GEOAPIFY_API_KEY,
    mapboxToken: config.MAPBOX_SECRET_TOKEN,
    quota: new QuotaManager(
      {
        geoapify_credits: config.BUDGET_GEOAPIFY_CREDITS_PER_DAY,
        mapbox_geocode: config.BUDGET_MAPBOX_GEOCODE_PER_DAY,
        mapbox_searchbox: config.BUDGET_MAPBOX_SEARCHBOX_PER_DAY,
        mapbox_directions: config.BUDGET_MAPBOX_DIRECTIONS_PER_DAY,
        mapbox_matrix_elements: config.BUDGET_MAPBOX_MATRIX_ELEMENTS_PER_DAY,
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
