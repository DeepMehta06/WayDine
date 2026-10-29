/**
 * Optional, anonymous search statistics. Disabled unless SEARCH_LOGGING=on and
 * Supabase credentials exist. Stores no coordinates, place names or IP
 * addresses: provider terms restrict persisting search-derived positions, and
 * aggregate counts are all the diagnostics need.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { log } from "../lib/log.js";

export interface SearchLogEntry {
  routeDistanceKm: number;
  maxDetourMinutes: number;
  diet: string;
  cuisineCount: number;
  resultCount: number;
  candidateCount: number;
  durationMs: number;
}

export interface SearchLogger {
  enabled: boolean;
  record(entry: SearchLogEntry): void;
}

export async function createSearchLogger(config: AppConfig): Promise<SearchLogger> {
  if (!config.capabilities.searchLogging) return { enabled: false, record: () => undefined };
  const { createClient } = await import("@supabase/supabase-js");
  const client: SupabaseClient = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  return {
    enabled: true,
    record(entry) {
      void client
        .from("search_log")
        .insert({
          route_distance_km: Math.round(entry.routeDistanceKm),
          max_detour_minutes: entry.maxDetourMinutes,
          diet: entry.diet,
          cuisine_count: entry.cuisineCount,
          result_count: entry.resultCount,
          candidate_count: entry.candidateCount,
          duration_ms: entry.durationMs,
        })
        .then(({ error }) => {
          if (error) log("warn", "search_log.insert_failed", { message: error.message });
        });
    },
  };
}
