import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowDownUp, ChevronDown, Loader2, LocateFixed, RotateCcw, Search } from "lucide-react";
import type { LngLat, UserPreferences } from "@contract";
import { useAuth } from "@/app/auth";
import { useTrip } from "@/app/trip";
import { Button } from "@/components/ui/button";
import { PlaceField } from "@/components/PlaceField";
import { BudgetPicker, CuisinePicker, DetourPicker, DietPicker } from "@/components/preferences/PreferenceControls";
import { ApiError, reversePlace } from "@/lib/api";
import { istLocalInputToIso, toIstLocalInput } from "@/lib/format";
import { describePreferences } from "@/lib/preferences";
import type { SelectedPlace } from "@/lib/search-state";
import { cn } from "@/lib/utils";

const MapView = lazy(() => import("@/components/MapView"));

function distanceM(a: LngLat, b: LngLat): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export default function PlanPage() {
  const { preferences } = useAuth();
  const { draft, setDraft, run } = useTrip();
  const navigate = useNavigate();
  const [sourceText, setSourceText] = useState(draft.source?.name ?? draft.sourceText ?? "");
  const [destText, setDestText] = useState(draft.destination?.name ?? draft.destinationText ?? "");
  const [touched, setTouched] = useState(false);
  const [showOverrides, setShowOverrides] = useState(Object.keys(draft.overrides).length > 0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<LngLat | null>(null);

  const saved = preferences;
  const effective: UserPreferences | null = saved ? { ...saved, ...draft.overrides } : null;
  const overriding = Object.keys(draft.overrides).length > 0;

  useEffect(() => {
    document.title = "Plan a trip · WayDine";
  }, []);

  const errors: { source?: string; destination?: string; departure?: string } = {};
  if (!draft.source) errors.source = sourceText.trim() ? "Choose a place from the list." : "Enter where you're starting.";
  if (!draft.destination) errors.destination = destText.trim() ? "Choose a place from the list." : "Enter where you're going.";
  if (draft.source && draft.destination && distanceM(draft.source.coordinates, draft.destination.coordinates) < 150) {
    errors.destination = "Start and destination are the same place.";
  }
  if (draft.departure.mode === "at") {
    const iso = istLocalInputToIso(draft.departure.local);
    const t = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(t)) errors.departure = "Pick a date and time.";
    else if (t < Date.now() - 10 * 60_000) errors.departure = "That time has passed.";
    else if (t > Date.now() + 14 * 86_400_000) errors.departure = "Plan up to 14 days ahead.";
  }
  const valid = Object.keys(errors).length === 0;

  function setOverride<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setDraft((d) => {
      const overrides = { ...d.overrides };
      if (saved && JSON.stringify(saved[key]) === JSON.stringify(value)) delete overrides[key];
      else overrides[key] = value;
      return { ...d, overrides };
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || !draft.source || !draft.destination) return;
    run({ draft: { ...draft, source: draft.source, destination: draft.destination } });
    navigate("/trip");
  }

  function useMyLocation() {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("This browser can't share your location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point: LngLat = [pos.coords.longitude, pos.coords.latitude];
        let name = "Your location";
        let secondary: string | null = `Accurate to about ${Math.round(pos.coords.accuracy)} m`;
        try {
          const { place } = await reversePlace(point);
          if (place) {
            name = `Near ${place.name}`;
            secondary = [place.secondary, secondary].filter(Boolean).join(" · ");
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === "OUT_OF_COVERAGE") {
            setLocating(false);
            setLocationError("Your location is outside India, which WayDine doesn't cover yet.");
            return;
          }
        }
        setLocating(false);
        const place: SelectedPlace = { id: `device:${Date.now()}`, name, secondary, kind: "address", coordinates: point, source: "device" };
        setSourceText(name);
        setDraft((d) => ({ ...d, source: place }));
      },
      (err) => {
        setLocating(false);
        setLocationError(err.code === err.PERMISSION_DENIED ? "Location permission was denied. Type your start instead." : "Couldn't get your location.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  function moveEndpoint(which: "source" | "destination", point: LngLat) {
    setDraft((d) => {
      const place = d[which];
      return place ? { ...d, [which]: { ...place, coordinates: point, adjusted: true, secondary: "Pin moved on the map" } } : d;
    });
  }

  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,520px)_1fr]">
      <div className="order-2 border-border px-4 py-8 sm:px-6 lg:order-1 lg:border-r lg:py-10">
        <h1 className="font-display text-4xl leading-tight font-semibold tracking-wide text-primary">Where are you driving?</h1>
        <p className="mt-2 text-foreground/75">Stops are found along the route between these two places.</p>

        <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-5" aria-label="Trip details">
          <PlaceField
            id="from"
            label="From"
            placeholder="Area, landmark or address"
            text={sourceText}
            place={draft.source}
            onTextChange={(t) => {
              setSourceText(t);
              setDraft((d) => ({ ...d, source: null, sourceText: t }));
            }}
            onSelect={(p) => {
              setSourceText(p.name);
              setDraft((d) => ({ ...d, source: p, sourceText: p.name }));
            }}
            near={draft.destination?.coordinates ?? mapCenter}
            error={show("source") ?? locationError}
            action={
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-muted disabled:opacity-60"
              >
                {locating ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <LocateFixed aria-hidden className="size-3.5" />}
                {locating ? "Locating…" : "Use my location"}
              </button>
            }
          />

          <div className="-my-3 flex justify-end">
            <button
              type="button"
              aria-label="Swap start and destination"
              onClick={() => {
                setSourceText(destText);
                setDestText(sourceText);
                setDraft((d) => ({ ...d, source: d.destination, destination: d.source, sourceText: destText, destinationText: sourceText }));
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowDownUp aria-hidden className="size-3.5" />
              Swap
            </button>
          </div>

          <PlaceField
            id="to"
            label="To"
            placeholder="Area, landmark or address"
            text={destText}
            place={draft.destination}
            onTextChange={(t) => {
              setDestText(t);
              setDraft((d) => ({ ...d, destination: null, destinationText: t }));
            }}
            onSelect={(p) => {
              setDestText(p.name);
              setDraft((d) => ({ ...d, destination: p, destinationText: p.name }));
            }}
            near={draft.source?.coordinates ?? mapCenter}
            error={show("destination")}
          />

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Leaving</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-2">
              {(["now", "at"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={draft.departure.mode === m}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      departure: m === "now" ? { mode: "now" } : { mode: "at", local: toIstLocalInput(new Date(Date.now() + 30 * 60_000)) },
                    }))
                  }
                  className={cn(
                    "h-11 rounded-lg border text-sm font-medium transition-colors",
                    draft.departure.mode === m ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  {m === "now" ? "Now" : "Later"}
                </button>
              ))}
            </div>
            {draft.departure.mode === "at" && (
              <div className="mt-2">
                <label htmlFor="departure" className="sr-only">
                  Departure date and time, India time
                </label>
                <input
                  id="departure"
                  type="datetime-local"
                  value={draft.departure.local}
                  min={toIstLocalInput(new Date())}
                  onChange={(e) => setDraft((d) => ({ ...d, departure: { mode: "at", local: e.target.value } }))}
                  aria-invalid={Boolean(show("departure")) || undefined}
                  className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
                />
                <p className={cn("mt-1 text-xs", show("departure") ? "text-destructive" : "text-muted-foreground")}>
                  {show("departure") ?? "India time (IST). Opening hours are checked for when you'd arrive."}
                </p>
              </div>
            )}
          </fieldset>

          {effective && (
            <section aria-labelledby="trip-prefs" className="rounded-xl border border-border bg-card">
              <button
                type="button"
                aria-expanded={showOverrides}
                onClick={() => setShowOverrides((s) => !s)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <span>
                  <span id="trip-prefs" className="block text-sm font-medium">
                    {overriding ? "Preferences for this trip" : "Using your saved preferences"}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{describePreferences(effective)}</span>
                </span>
                <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", showOverrides && "rotate-180")} />
              </button>
              {showOverrides && (
                <div className="flex flex-col gap-7 border-t border-border p-4">
                  <div>
                    <h3 className="mb-3 font-sans text-sm font-semibold tracking-normal">Food</h3>
                    <DietPicker
                      value={effective.diet}
                      onChange={(v) => setOverride("diet", v)}
                      includeUnconfirmed={effective.includeUnconfirmedDiet}
                      onIncludeUnconfirmed={(v) => setOverride("includeUnconfirmedDiet", v)}
                    />
                  </div>
                  <div>
                    <h3 className="mb-3 font-sans text-sm font-semibold tracking-normal">Extra driving</h3>
                    <DetourPicker value={effective.maxDetourMinutes} onChange={(v) => setOverride("maxDetourMinutes", v)} />
                  </div>
                  <div>
                    <h3 className="mb-3 font-sans text-sm font-semibold tracking-normal">Cuisine</h3>
                    <CuisinePicker value={effective.cuisines} onChange={(v) => setOverride("cuisines", v)} />
                  </div>
                  <div>
                    <h3 className="mb-3 font-sans text-sm font-semibold tracking-normal">Budget</h3>
                    <BudgetPicker value={effective.budgetPerPersonInr} onChange={(v) => setOverride("budgetPerPersonInr", v)} />
                  </div>
                  {overriding && (
                    <Button type="button" variant="ghost" className="w-fit" onClick={() => setDraft((d) => ({ ...d, overrides: {} }))}>
                      <RotateCcw aria-hidden />
                      Use my saved preferences
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">Changes here apply to this trip only. Edit your defaults under Preferences.</p>
                </div>
              )}
            </section>
          )}

          <Button type="submit" size="lg" className="h-12 text-base" aria-disabled={!valid || undefined}>
            <Search aria-hidden />
            Find stops on my route
          </Button>
        </form>
      </div>

      <div className="order-1 h-[34svh] border-b border-border lg:sticky lg:top-14 lg:order-2 lg:h-[calc(100dvh-3.5rem)] lg:border-b-0">
        <Suspense fallback={<div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">Loading map…</div>}>
          <MapView
            source={draft.source}
            destination={draft.destination}
            route={null}
            routeStale={false}
            recommendations={[]}
            selectedId={null}
            onSelect={() => undefined}
            onEndpointMove={moveEndpoint}
            onCenterChange={setMapCenter}
          />
        </Suspense>
      </div>
    </main>
  );
}
