import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Loader2, LogOut, RotateCcw } from "lucide-react";
import type { UserPreferences } from "@contract";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { BudgetPicker, CuisinePicker, DetourPicker, DietPicker } from "@/components/preferences/PreferenceControls";
import { ApiError } from "@/lib/api";
import { TripHistoryPanel } from "@/components/trip/TripHistoryPanel";

export default function ProfilePage() {
  const { user, preferences, updatePreferences, resetToDefaults, signOutUser } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<UserPreferences | null>(preferences);
  const [state, setState] = useState<{ busy: "save" | "reset" | "signout" | null; message: string | null; error: string | null }>({ busy: null, message: null, error: null });

  useEffect(() => {
    document.title = "Your account · WayDine";
  }, []);
  useEffect(() => setPrefs(preferences), [preferences]);

  if (!prefs) return null;
  const dirty = JSON.stringify(prefs) !== JSON.stringify(preferences);

  async function act(kind: "save" | "reset" | "signout") {
    setState({ busy: kind, message: null, error: null });
    try {
      if (kind === "save") await updatePreferences(prefs!);
      if (kind === "reset") await resetToDefaults();
      if (kind === "signout") {
        await signOutUser();
        navigate("/");
        return;
      }
      setState({ busy: null, message: kind === "save" ? "Preferences saved." : "Reset to defaults.", error: null });
    } catch (err) {
      setState({ busy: null, message: null, error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
  }

  const set = <K extends keyof UserPreferences>(k: K, v: UserPreferences[K]) => setPrefs((p) => (p ? { ...p, [k]: v } : p));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <section aria-labelledby="account-title" className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-14 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-muted font-display text-2xl text-primary">
            {(user?.displayName || user?.email || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 id="account-title" className="truncate font-sans text-lg font-semibold tracking-normal">
            {user?.displayName || "Your account"}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{user?.email} · signed in with Google</p>
        </div>
        <Button variant="outline" onClick={() => void act("signout")} disabled={state.busy !== null}>
          {state.busy === "signout" ? <Loader2 aria-hidden className="animate-spin" /> : <LogOut aria-hidden />}
          Sign out
        </Button>
      </section>

      <TripHistoryPanel key={user?.id} preview />

      <h2 className="mt-10 font-display text-3xl font-semibold tracking-wide text-primary">Your trip defaults</h2>
      <p className="mt-1.5 text-foreground/75">Every search starts from these. You can still change them for a single trip.</p>

      <div className="mt-8 flex flex-col gap-10">
        <section aria-labelledby="p-food">
          <h3 id="p-food" className="mb-3 font-sans text-base font-semibold tracking-normal">
            Food
          </h3>
          <DietPicker value={prefs.diet} onChange={(v) => set("diet", v)} includeUnconfirmed={prefs.includeUnconfirmedDiet} onIncludeUnconfirmed={(v) => set("includeUnconfirmedDiet", v)} />
        </section>
        <section aria-labelledby="p-detour">
          <h3 id="p-detour" className="mb-3 font-sans text-base font-semibold tracking-normal">
            Extra driving
          </h3>
          <DetourPicker value={prefs.maxDetourMinutes} onChange={(v) => set("maxDetourMinutes", v)} />
        </section>
        <section aria-labelledby="p-cuisine">
          <h3 id="p-cuisine" className="mb-3 font-sans text-base font-semibold tracking-normal">
            Cuisine
          </h3>
          <CuisinePicker value={prefs.cuisines} onChange={(v) => set("cuisines", v)} />
        </section>
        <section aria-labelledby="p-budget">
          <h3 id="p-budget" className="mb-3 font-sans text-base font-semibold tracking-normal">
            Budget
          </h3>
          <BudgetPicker key={String(preferences?.budgetPerPersonInr)} value={prefs.budgetPerPersonInr} onChange={(v) => set("budgetPerPersonInr", v)} />
        </section>
      </div>

      <div className="sticky bottom-0 mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-4 backdrop-blur">
        <div aria-live="polite" className="text-sm">
          {state.error ? (
            <span className="text-destructive">{state.error}</span>
          ) : state.message ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Check aria-hidden className="size-4" />
              {state.message}
            </span>
          ) : dirty ? (
            <span className="text-muted-foreground">You have unsaved changes.</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void act("reset")} disabled={state.busy !== null}>
            {state.busy === "reset" ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCcw aria-hidden />}
            Reset to defaults
          </Button>
          <Button onClick={() => void act("save")} disabled={!dirty || state.busy !== null} className="h-10 px-4">
            {state.busy === "save" && <Loader2 aria-hidden className="animate-spin" />}
            Save preferences
          </Button>
        </div>
      </div>
    </main>
  );
}
