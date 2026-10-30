import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import type { AuthUser } from "../contract/api.js";
import { AppError } from "../errors.js";

export interface StoredSession {
  token_hash: string;
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  access_expires_at: string;
  expires_at: string;
}

export interface AuthStore {
  saveProfile(user: AuthUser): Promise<void>;
  insertSession(session: StoredSession): Promise<void>;
  findSession(hash: string): Promise<StoredSession | null>;
  updateTokens(hash: string, tokens: Pick<StoredSession, "access_token_encrypted" | "refresh_token_encrypted" | "access_expires_at">): Promise<boolean>;
  deleteSession(hash: string): Promise<void>;
}

/** Only this backend holds the service key. Session rows have no public RLS policies. */
export function createSupabaseAuthStore(config: AppConfig, fetchImpl: typeof fetch = fetch): AuthStore {
  const db = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  const check = (error: unknown) => {
    if (error) throw new AppError("UPSTREAM_UNAVAILABLE", "Account storage is unavailable. Please try again.", { diagnostic: "auth storage operation failed; check configuration and migration 004" });
  };
  return {
    async saveProfile(user) {
      const { error } = await db.from("profiles").upsert({
        id: user.id, email: user.email, display_name: user.displayName, avatar_url: user.avatarUrl,
        provider: user.provider, last_sign_in_at: user.lastSignInAt,
      }, { onConflict: "id" });
      check(error);
    },
    async insertSession(session) {
      const { error } = await db.from("auth_sessions").insert(session);
      check(error);
    },
    async findSession(hash) {
      const { data, error } = await db.from("auth_sessions").select("token_hash,user_id,access_token_encrypted,refresh_token_encrypted,access_expires_at,expires_at").eq("token_hash", hash).maybeSingle();
      check(error);
      return data as StoredSession | null;
    },
    async updateTokens(hash, tokens) {
      const { data, error } = await db.from("auth_sessions").update(tokens).eq("token_hash", hash).select("token_hash");
      check(error);
      return Boolean(data?.length);
    },
    async deleteSession(hash) {
      const { error } = await db.from("auth_sessions").delete().eq("token_hash", hash);
      check(error);
    },
  };
}
