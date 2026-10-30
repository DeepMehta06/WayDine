/** Session and saved-preference state shared by every page. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser, UserPreferences, UserPreferencesPatch } from "@contract";
import { ApiError, getAccount, getAuthStatus, getPreferences, googleSignInUrl, resetPreferences, savePreferences, signOut } from "@/lib/api";

export type AuthStatus = "loading" | "signed-in" | "signed-out" | "unavailable";

interface AuthValue {
  status: AuthStatus;
  user: AuthUser | null;
  preferences: UserPreferences | null;
  /** False until the user has saved preferences at least once (drives onboarding). */
  preferencesSaved: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updatePreferences: (patch: UserPreferencesPatch) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  signIn: (returnTo?: string) => void;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const RETURN_KEY = "waydine:return-to";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { user: account } = await getAccount();
      setUser(account);
      try {
        const prefs = await getPreferences();
        setPreferences(prefs.preferences);
        setPreferencesSaved(prefs.saved);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't load your preferences.");
      }
      setStatus("signed-in");
    } catch (err) {
      setUser(null);
      setPreferences(null);
      if (err instanceof ApiError && err.code === "NOT_CONFIGURED") {
        setStatus("unavailable");
        return;
      }
      if (err instanceof ApiError && err.code === "UNAUTHENTICATED") {
        try {
          const s = await getAuthStatus();
          setStatus(s.enabled ? "signed-out" : "unavailable");
        } catch {
          setStatus("signed-out");
        }
        return;
      }
      setError(err instanceof ApiError ? err.message : "Couldn't check your sign-in.");
      setStatus("signed-out");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updatePreferences = useCallback(async (patch: UserPreferencesPatch) => {
    const res = await savePreferences(patch);
    setPreferences(res.preferences);
    setPreferencesSaved(res.saved);
  }, []);

  const resetToDefaults = useCallback(async () => {
    const res = await resetPreferences();
    setPreferences(res.preferences);
    setPreferencesSaved(res.saved);
  }, []);

  const signIn = useCallback((returnTo = "/plan") => {
    try {
      sessionStorage.setItem(RETURN_KEY, returnTo);
    } catch {
      // Private mode: the user simply lands on the home page after signing in.
    }
    window.location.assign(googleSignInUrl);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut();
    setUser(null);
    setPreferences(null);
    setPreferencesSaved(false);
    setStatus("signed-out");
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, preferences, preferencesSaved, error, refresh, updatePreferences, resetToDefaults, signIn, signOutUser }),
    [status, user, preferences, preferencesSaved, error, refresh, updatePreferences, resetToDefaults, signIn, signOutUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Reads and clears where the user wanted to go before the Google redirect. */
// eslint-disable-next-line react-refresh/only-export-components
export function takeReturnPath(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
  } catch {
    return null;
  }
}
