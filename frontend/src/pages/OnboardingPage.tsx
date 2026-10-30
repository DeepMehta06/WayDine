import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { UserPreferences } from "@contract";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { BudgetPicker, CuisinePicker, DetourPicker, DietPicker } from "@/components/preferences/PreferenceControls";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULTS: UserPreferences = { diet: "any", cuisines: [], includeUnconfirmedDiet: false, maxDetourMinutes: 10, budgetPerPersonInr: null };

const STEPS = [
  { key: "diet", title: "How do you eat?", body: "We only call a place vegetarian when its listing says so." },
  { key: "cuisine", title: "Any cuisines you're after?", body: "Pick a few, or leave it open. You can change this for any trip." },
  { key: "detour", title: "How much extra driving is a good meal worth?", body: "Stops that add more than this are left out." },
  { key: "budget", title: "Spend per person", body: "Used with Google's listed price ranges, which are estimates." },
] as const;

export default function OnboardingPage() {
  const { user, preferences, updatePreferences } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<UserPreferences>(preferences ?? DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;
  const firstName = user?.displayName?.split(" ")[0];

  async function finish(values: UserPreferences) {
    setSaving(true);
    setError(null);
    try {
      await updatePreferences(values);
      navigate(from && from !== "/onboarding" ? from : "/plan", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your preferences. Try again.");
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:py-14">
      <p className="text-sm text-muted-foreground">{firstName ? `Welcome, ${firstName}.` : "Welcome."} Set up your defaults once.</p>
      <ol className="mt-4 flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <li key={s.key} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-border")} />
        ))}
      </ol>

      <section aria-labelledby="step-title" className="mt-10 flex-1">
        <p className="text-sm font-medium text-primary tabular-nums">
          {step + 1} / {STEPS.length}
        </p>
        <h1 id="step-title" className="mt-1 font-display text-4xl leading-tight font-semibold tracking-wide text-balance">
          {current.title}
        </h1>
        <p className="mt-2 text-foreground/75">{current.body}</p>

        <div className="mt-8">
          {current.key === "diet" && (
            <DietPicker
              value={prefs.diet}
              onChange={(diet) => setPrefs((p) => ({ ...p, diet }))}
              includeUnconfirmed={prefs.includeUnconfirmedDiet}
              onIncludeUnconfirmed={(includeUnconfirmedDiet) => setPrefs((p) => ({ ...p, includeUnconfirmedDiet }))}
            />
          )}
          {current.key === "cuisine" && <CuisinePicker value={prefs.cuisines} onChange={(cuisines) => setPrefs((p) => ({ ...p, cuisines }))} />}
          {current.key === "detour" && (
            <DetourPicker value={prefs.maxDetourMinutes} onChange={(maxDetourMinutes) => setPrefs((p) => ({ ...p, maxDetourMinutes }))} />
          )}
          {current.key === "budget" && (
            <BudgetPicker value={prefs.budgetPerPersonInr} onChange={(budgetPerPersonInr) => setPrefs((p) => ({ ...p, budgetPerPersonInr }))} />
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-6">
        <div className="flex items-center gap-1">
          {step > 0 && (
            <Button type="button" variant="ghost" size="lg" onClick={() => setStep((s) => s - 1)} disabled={saving}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
          )}
          <Button type="button" variant="link" size="lg" onClick={() => void finish(DEFAULTS)} disabled={saving} className="text-muted-foreground">
            Skip, use defaults
          </Button>
        </div>
        <Button type="button" size="lg" className="h-11 px-5" disabled={saving} onClick={() => (last ? void finish(prefs) : setStep((s) => s + 1))}>
          {saving && <Loader2 aria-hidden className="animate-spin" />}
          {last ? "Save and plan a trip" : "Next"}
          {!last && <ArrowRight aria-hidden />}
        </Button>
      </div>
    </main>
  );
}
