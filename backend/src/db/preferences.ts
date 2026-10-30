import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { UserPreferences, UserPreferencesPatch } from "../contract/api.js";
import { userPreferencesSchema } from "../domain/preferences.js";
import { AppError } from "../errors.js";

export interface SavedUserPreferences {
  preferences: UserPreferences;
  updatedAt: string;
}

export interface PreferencesStore {
  find(userId: string): Promise<SavedUserPreferences | null>;
  patch(userId: string, patch: UserPreferencesPatch): Promise<SavedUserPreferences>;
  reset(userId: string): Promise<void>;
}

const rowSchema = z.object({
  user_id: z.string().uuid(),
  diet: userPreferencesSchema.shape.diet,
  cuisines: userPreferencesSchema.shape.cuisines,
  include_unconfirmed_diet: userPreferencesSchema.shape.includeUnconfirmedDiet,
  max_detour_minutes: userPreferencesSchema.shape.maxDetourMinutes,
  budget_per_person_inr: userPreferencesSchema.shape.budgetPerPersonInr,
  updated_at: z.string().datetime({ offset: true }),
});
const columns = "user_id,diet,cuisines,include_unconfirmed_diet,max_detour_minutes,budget_per_person_inr,updated_at";
const unavailable = () => new AppError("UPSTREAM_UNAVAILABLE", "Saved preferences are unavailable. Please try again.", {
  diagnostic: "preferences storage failed; check configuration and migration 005",
});

/** The owner always comes from server-verified identity, never from request JSON. */
export function createSupabasePreferencesStore(config: AppConfig, fetchImpl: typeof fetch = fetch): PreferencesStore {
  const db = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  const parse = (raw: unknown, userId: string): SavedUserPreferences => {
    const result = rowSchema.safeParse(raw);
    if (!result.success || result.data.user_id !== userId) throw unavailable();
    const row = result.data;
    return { preferences: { diet: row.diet, cuisines: row.cuisines, includeUnconfirmedDiet: row.include_unconfirmed_diet,
      maxDetourMinutes: row.max_detour_minutes, budgetPerPersonInr: row.budget_per_person_inr }, updatedAt: row.updated_at };
  };
  return {
    async find(userId) {
      const { data, error } = await db.from("user_preferences").select(columns).eq("user_id", userId).maybeSingle();
      if (error) throw unavailable();
      return data === null ? null : parse(data, userId);
    },
    async patch(userId, patch) {
      // One atomic database operation. No read/merge/write race between partial updates.
      const { data, error } = await db.rpc("waydine_patch_preferences", { p_user_id: userId, p_patch: patch }).single();
      if (error) throw unavailable();
      return parse(data, userId);
    },
    async reset(userId) {
      const { error } = await db.from("user_preferences").delete().eq("user_id", userId);
      if (error) throw unavailable();
    },
  };
}
