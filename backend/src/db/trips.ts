/** Account-owned search summaries; provider records, coordinates and geometry are not retained. */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { TripHistoryEntry, UserPreferences } from "../contract/api.js";
import { userPreferencesSchema } from "../domain/preferences.js";
import { AppError } from "../errors.js";

export interface TripCursor { at: string; id: string }
export interface NewTripSummary {
  requestId: string;
  sourceLabel: string;
  destinationLabel: string;
  departureTime: string;
  preferences: UserPreferences;
  resultCount: number;
}
export interface TripHistoryStore {
  list(userId: string, before: TripCursor | null, limit: number): Promise<TripHistoryEntry[]>;
  record(userId: string, trip: NewTripSummary): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
  clear(userId: string): Promise<void>;
}

const rowSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(),
  source_label: z.string().min(1).max(120), destination_label: z.string().min(1).max(120),
  created_at: z.string().datetime({ offset: true }), departure_time: z.string().datetime({ offset: true }),
  preferences: userPreferencesSchema, result_count: z.number().int().min(0).max(1000),
});
const columns = "id,user_id,source_label,destination_label,created_at,departure_time,preferences,result_count";
const unavailable = () => new AppError("UPSTREAM_UNAVAILABLE", "Trip history is unavailable. Please try again.", {
  diagnostic: "trip history storage failed; check migration 006",
});

export function createSupabaseTripHistoryStore(config: AppConfig, fetchImpl: typeof fetch = fetch): TripHistoryStore {
  const db = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  return {
    async list(userId, before, limit) {
      let query = db.from("trip_history").select(columns).eq("user_id", userId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      if (before) query = query.or(`created_at.lt.${before.at},and(created_at.eq.${before.at},id.lt.${before.id})`);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw unavailable();
      return data.map(raw => {
        const parsed = rowSchema.safeParse(raw);
        if (!parsed.success || parsed.data.user_id !== userId) throw unavailable();
        const row = parsed.data;
        return { id: row.id, sourceLabel: row.source_label, destinationLabel: row.destination_label,
          createdAt: row.created_at, departureTime: row.departure_time, preferences: row.preferences, resultCount: row.result_count };
      });
    },
    async record(userId, trip) {
      const { error } = await db.from("trip_history").upsert({
        user_id: userId, request_id: trip.requestId, source_label: trip.sourceLabel,
        destination_label: trip.destinationLabel, departure_time: trip.departureTime,
        preferences: trip.preferences, result_count: trip.resultCount,
      }, { onConflict: "user_id,request_id", ignoreDuplicates: true });
      if (error) throw unavailable();
    },
    async remove(userId, id) {
      const { error } = await db.from("trip_history").delete().eq("user_id", userId).eq("id", id);
      if (error) throw unavailable();
    },
    async clear(userId) {
      const { error } = await db.from("trip_history").delete().eq("user_id", userId);
      if (error) throw unavailable();
    },
  };
}
