import { createClient, type SupabaseClient, type User, type Session } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import type { AuthUser } from "../contract/api.js";
import { AppError } from "../errors.js";

export type VerifierStorage = Record<string, string>;
export interface AuthTokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface AuthProvider {
  begin(callbackUrl: string): Promise<{ url: string; storage: VerifierStorage }>;
  exchange(code: string, storage: VerifierStorage): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  verify(accessToken: string): Promise<AuthUser>;
  revoke(accessToken: string): Promise<void>;
}

export function accountFromGoogle(user: User): AuthUser {
  // app_metadata and identities come from Supabase Auth, never a client-supplied profile.
  const google = user.identities?.some((identity) => identity.provider === "google") || user.app_metadata.provider === "google";
  if (!google || !user.email || !user.email_confirmed_at) {
    throw new AppError("AUTH_FAILED", "Sign in with a verified Google account.");
  }
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const avatar = text(user.user_metadata.avatar_url ?? user.user_metadata.picture, 2048);
  return {
    id: user.id,
    email: user.email,
    displayName: text(user.user_metadata.full_name ?? user.user_metadata.name, 200),
    avatarUrl: avatar && /^https:\/\//i.test(avatar) ? avatar : null,
    provider: "google",
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

const failed = () => new AppError("AUTH_FAILED", "Google sign-in could not be completed. Please try again.");

function tokens(session: Session | null): AuthTokens {
  if (!session?.access_token || !session.refresh_token || !session.expires_at) throw failed();
  return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at };
}

/** Clients and PKCE storage are per operation, so users never share SDK session state. */
export function createSupabaseAuthProvider(config: AppConfig, fetchImpl: typeof fetch = fetch): AuthProvider {
  const client = (storage: VerifierStorage = {}): SupabaseClient => createClient(config.SUPABASE_URL!, config.SUPABASE_PUBLISHABLE_KEY!, {
    auth: {
      flowType: "pkce", storageKey: "waydine-auth", persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem: (key) => storage[key] ?? null,
        setItem: (key, value) => { storage[key] = value; },
        removeItem: (key) => { delete storage[key]; },
      },
    },
    global: { fetch: async (input, init) => {
      try {
        return await fetchImpl(input, { ...init, signal: AbortSignal.timeout(8000) });
      } catch {
        throw new AppError("UPSTREAM_UNAVAILABLE", "The sign-in service is unavailable. Please try again.");
      }
    } },
  });
  const check = (error: { status?: number } | null, invalid: "AUTH_FAILED" | "UNAUTHENTICATED" = "AUTH_FAILED") => {
    if (!error) return;
    if (!error.status || error.status >= 500 || error.status === 429) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "The sign-in service is unavailable. Please try again.");
    }
    throw new AppError(invalid, invalid === "UNAUTHENTICATED" ? "Your session has expired. Sign in again." : "Google sign-in could not be completed. Please try again.");
  };
  return {
    async begin(callbackUrl) {
      const storage: VerifierStorage = {};
      const { data, error } = await client(storage).auth.signInWithOAuth({
        provider: "google", options: { redirectTo: callbackUrl, skipBrowserRedirect: true, scopes: "openid email profile", queryParams: { prompt: "select_account" } },
      });
      check(error);
      if (!data.url) throw failed();
      return { url: data.url, storage };
    },
    async exchange(code, storage) {
      const { data, error } = await client({ ...storage }).auth.exchangeCodeForSession(code);
      check(error);
      return tokens(data.session);
    },
    async refresh(refreshToken) {
      const { data, error } = await client().auth.refreshSession({ refresh_token: refreshToken });
      check(error, "UNAUTHENTICATED");
      return tokens(data.session);
    },
    async verify(accessToken) {
      const { data, error } = await client().auth.getUser(accessToken);
      check(error, "UNAUTHENTICATED");
      if (!data.user) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
      return accountFromGoogle(data.user);
    },
    async revoke(accessToken) {
      const { error } = await client().auth.admin.signOut(accessToken, "local");
      if (error && error.status !== 401 && error.status !== 403 && error.status !== 404) check(error);
    },
  };
}
