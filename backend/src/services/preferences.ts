import type { AppConfig } from "../config.js";
import type { UserPreferencesResponse } from "../contract/api.js";
import { createSupabasePreferencesStore, type PreferencesStore } from "../db/preferences.js";
import { defaultUserPreferences, userPreferencesPatchSchema } from "../domain/preferences.js";
import { AppError } from "../errors.js";

export class PreferencesService {
  constructor(private readonly store: PreferencesStore) {}

  async get(userId: string): Promise<UserPreferencesResponse> {
    const saved = await this.store.find(userId);
    return saved ? { ...saved, saved: true } : this.defaults();
  }

  async patch(userId: string, body: unknown): Promise<UserPreferencesResponse> {
    const result = userPreferencesPatchSchema.safeParse(body);
    if (!result.success) throw new AppError("BAD_REQUEST", "Some preferences are missing or invalid.", { details: result.error.flatten() });
    const saved = await this.store.patch(userId, result.data);
    return { ...saved, saved: true };
  }

  async reset(userId: string): Promise<UserPreferencesResponse> {
    await this.store.reset(userId);
    return this.defaults();
  }

  private defaults(): UserPreferencesResponse {
    return { preferences: defaultUserPreferences(), saved: false, updatedAt: null };
  }
}

export function createPreferencesService(config: AppConfig): PreferencesService | null {
  return config.capabilities.auth ? new PreferencesService(createSupabasePreferencesStore(config)) : null;
}
