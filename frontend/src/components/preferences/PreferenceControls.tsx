/** Preference inputs shared by onboarding, the profile page and per-trip overrides. */
import { useId, useState } from "react";
import { Check, Leaf, Salad, UtensilsCrossed } from "lucide-react";
import { CUISINE_OPTIONS, type CuisineId, type DietPreference } from "@contract";
import { cn } from "@/lib/utils";

const DIETS: Array<{ value: DietPreference; title: string; body: string; icon: typeof Leaf }> = [
  { value: "any", title: "Anything", body: "Show every kind of restaurant.", icon: UtensilsCrossed },
  { value: "vegetarian-options", title: "Has veg options", body: "Listed as serving vegetarian food.", icon: Salad },
  { value: "pure-veg", title: "Pure veg only", body: "Only places confirmed as fully vegetarian.", icon: Leaf },
];

export function DietPicker({
  value,
  onChange,
  includeUnconfirmed,
  onIncludeUnconfirmed,
}: {
  value: DietPreference;
  onChange: (v: DietPreference) => void;
  includeUnconfirmed: boolean;
  onIncludeUnconfirmed: (v: boolean) => void;
}) {
  const name = useId();
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Food preference" className="grid gap-2.5 sm:grid-cols-3">
        {DIETS.map(({ value: v, title, body, icon: Icon }) => {
          const on = value === v;
          return (
            <label
              key={v}
              className={cn(
                "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                on ? "border-primary bg-secondary" : "border-border bg-card hover:border-primary/40"
              )}
            >
              <input type="radio" name={name} value={v} checked={on} onChange={() => onChange(v)} className="sr-only" />
              <Icon aria-hidden className={cn("size-5", on ? "text-primary" : "text-muted-foreground")} />
              <span className="font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{body}</span>
              {on && <Check aria-hidden className="absolute top-3 right-3 size-4 text-primary" />}
            </label>
          );
        })}
      </div>
      {value !== "any" && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm">
          <input
            type="checkbox"
            checked={includeUnconfirmed}
            onChange={(e) => onIncludeUnconfirmed(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="font-medium">Also show places with no dietary information</span>
            <span className="block text-muted-foreground">They'll be marked "veg unconfirmed". Veg status is never guessed from a restaurant's name.</span>
          </span>
        </label>
      )}
    </div>
  );
}

export function CuisinePicker({ value, onChange }: { value: CuisineId[]; onChange: (v: CuisineId[]) => void }) {
  const toggle = (c: CuisineId) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Cuisines">
        <button
          type="button"
          aria-pressed={value.length === 0}
          onClick={() => onChange([])}
          className={cn(
            "rounded-full border px-4 py-2 text-sm transition-colors",
            value.length === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
          )}
        >
          Any cuisine
        </button>
        {CUISINE_OPTIONS.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm capitalize transition-colors",
                on ? "border-primary bg-secondary text-secondary-foreground" : "border-border bg-card hover:border-primary/40"
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        {value.length === 0 ? "Every cuisine is shown." : "Only places whose Google listing mentions one of these are shown."}
      </p>
    </div>
  );
}

export const DETOUR_CHOICES = [2, 5, 10, 15, 20, 30] as const;

export function DetourPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Maximum extra driving" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {DETOUR_CHOICES.map((m) => {
          const on = value === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(m)}
              className={cn(
                "flex flex-col items-center rounded-xl border py-3 transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
              )}
            >
              <span className="font-display text-2xl leading-none font-semibold tabular-nums">{m}</span>
              <span className={cn("mt-1 text-xs", on ? "text-primary-foreground/80" : "text-muted-foreground")}>min</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Extra minutes a stop may add to your trip, including getting back onto your route.</p>
    </div>
  );
}

const BUDGETS = [200, 400, 700, 1000] as const;

export function BudgetPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const custom = value !== null && !(BUDGETS as readonly number[]).includes(value);
  const [draft, setDraft] = useState(custom ? String(value) : "");
  const inputId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Budget per person" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={cn(
            "rounded-full border px-4 py-2 text-sm transition-colors",
            value === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
          )}
        >
          No limit
        </button>
        {BUDGETS.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={value === b}
            onClick={() => onChange(b)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm tabular-nums transition-colors",
              value === b ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
            )}
          >
            Up to ₹{b.toLocaleString("en-IN")}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="text-sm text-muted-foreground">
          Or your own limit ₹
        </label>
        <input
          id={inputId}
          inputMode="numeric"
          value={draft}
          placeholder="e.g. 500"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setDraft(v);
            const n = Number(v);
            if (v && n >= 1 && n <= 100000) onChange(n);
          }}
          className="h-10 w-28 rounded-lg border border-input bg-card px-3 text-sm tabular-nums"
        />
      </div>
      <p className="text-sm text-muted-foreground">Per person, in rupees. Places whose Google price range starts above this are hidden; places with no listed price stay, marked "price unconfirmed".</p>
    </div>
  );
}
