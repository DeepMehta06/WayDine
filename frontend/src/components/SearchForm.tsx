import { useState, type FormEvent } from "react";
import { ArrowDownUp, Loader2, LocateFixed, RotateCcw } from "lucide-react";
import { CUISINE_OPTIONS, type CuisineId, type DietPreference, type LngLat } from "@contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PlaceField } from "@/components/PlaceField";
import { ApiError, reversePlace } from "@/lib/api";
import { istLocalInputToIso, toIstLocalInput } from "@/lib/format";
import { DETOUR_OPTIONS, type SelectedPlace, type TripPreferences } from "@/lib/search-state";

export interface EndpointInput {
  text: string;
  place: SelectedPlace | null;
}

interface SearchFormProps {
  source: EndpointInput;
  destination: EndpointInput;
  onSourceChange: (v: EndpointInput) => void;
  onDestinationChange: (v: EndpointInput) => void;
  prefs: TripPreferences;
  onPrefsChange: (p: TripPreferences) => void;
  biasFor: (field: "source" | "destination") => LngLat | null;
  onSubmit: () => void;
  onCancel: () => void;
  onSwap: () => void;
  onReset: () => void;
  loading: boolean;
  serverFieldErrors: Record<string, string[]>;
}

const MIN_SEPARATION_M = 150;

function distanceM(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function validateTrip(source: EndpointInput, destination: EndpointInput, prefs: TripPreferences, now = new Date()) {
  const errors: { source?: string; destination?: string; departure?: string } = {};
  if (!source.place) errors.source = source.text.trim() ? "Choose a place from the list." : "Enter where you're starting.";
  if (!destination.place) errors.destination = destination.text.trim() ? "Choose a place from the list." : "Enter where you're going.";
  if (source.place && destination.place && distanceM(source.place.coordinates, destination.place.coordinates) < MIN_SEPARATION_M) {
    errors.destination = "Start and destination are the same place.";
  }
  if (prefs.departure.mode === "at") {
    const iso = istLocalInputToIso(prefs.departure.local);
    const t = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(t)) errors.departure = "Pick a date and time.";
    else if (t < now.getTime() - 10 * 60_000) errors.departure = "That time has passed. Choose “Leave now” or a later time.";
    else if (t > now.getTime() + 14 * 86_400_000) errors.departure = "Plan up to 14 days ahead.";
  }
  return errors;
}

const DIET_LABELS: Record<DietPreference, string> = {
  any: "Any",
  "vegetarian-options": "Has veg options",
  "pure-veg": "Pure veg only",
};

export function SearchForm(props: SearchFormProps) {
  const { source, destination, prefs, onPrefsChange, loading, serverFieldErrors } = props;
  const [touched, setTouched] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const errors = validateTrip(source, destination, prefs);
  const canSubmit = Object.keys(errors).length === 0;
  const show = (field: "source" | "destination" | "departure") => (touched ? errors[field] : undefined) ?? serverFieldErrors[field]?.[0];

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (canSubmit && !loading) props.onSubmit();
  }

  function useMyLocation() {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("This browser can't share your location. Type your starting point instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point: LngLat = [pos.coords.longitude, pos.coords.latitude];
        let label = "Your location";
        let secondary: string | null = `Accurate to about ${Math.round(pos.coords.accuracy)} m`;
        try {
          const { place } = await reversePlace(point);
          if (place) {
            label = `Near ${place.name}`;
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
        props.onSourceChange({
          text: label,
          place: { id: `device:${Date.now()}`, name: label, secondary, kind: "address", coordinates: point, source: "device" },
        });
      },
      (err) => {
        setLocating(false);
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Type your starting point instead."
            : "Couldn't get your location. Type your starting point instead."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  const departure = prefs.departure;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-label="Trip details">
      <PlaceField
        id="source"
        label="Starting from"
        placeholder="Area, landmark or address"
        text={source.text}
        place={source.place}
        onTextChange={(text) => props.onSourceChange({ text, place: null })}
        onSelect={(place) => props.onSourceChange({ text: place.name, place })}
        near={props.biasFor("source")}
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

      <div className="-my-2 flex justify-end">
        <button
          type="button"
          onClick={props.onSwap}
          disabled={!source.text && !destination.text}
          aria-label="Swap start and destination"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ArrowDownUp aria-hidden className="size-3.5" />
          Swap
        </button>
      </div>

      <PlaceField
        id="destination"
        label="Driving to"
        placeholder="Area, landmark or address"
        text={destination.text}
        place={destination.place}
        onTextChange={(text) => props.onDestinationChange({ text, place: null })}
        onSelect={(place) => props.onDestinationChange({ text: place.name, place })}
        near={props.biasFor("destination")}
        error={show("destination")}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Leaving</legend>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={departure.mode}
          onValueChange={(v) => {
            if (v === "now") onPrefsChange({ ...prefs, departure: { mode: "now" } });
            if (v === "at") onPrefsChange({ ...prefs, departure: { mode: "at", local: toIstLocalInput(new Date(Date.now() + 30 * 60_000)) } });
          }}
          className="w-full"
        >
          <ToggleGroupItem value="now" className="h-10 flex-1">
            Now
          </ToggleGroupItem>
          <ToggleGroupItem value="at" className="h-10 flex-1">
            Later
          </ToggleGroupItem>
        </ToggleGroup>
        {departure.mode === "at" && (
          <div>
            <Label htmlFor="departure" className="sr-only">
              Departure date and time (India time)
            </Label>
            <Input
              id="departure"
              type="datetime-local"
              value={departure.local}
              min={toIstLocalInput(new Date())}
              aria-invalid={Boolean(show("departure")) || undefined}
              aria-describedby="departure-hint"
              onChange={(e) => onPrefsChange({ ...prefs, departure: { mode: "at", local: e.target.value } })}
              className="h-11 md:h-10"
            />
            <p id="departure-hint" className={show("departure") ? "mt-1 text-xs text-destructive" : "mt-1 text-xs text-muted-foreground"}>
              {show("departure") ?? "India time (IST). Opening hours are checked for when you'd arrive."}
            </p>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Extra driving I'll accept</legend>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={String(prefs.maxDetourMinutes)}
          onValueChange={(v) => v && onPrefsChange({ ...prefs, maxDetourMinutes: Number(v) })}
          className="w-full"
          aria-label="Maximum extra driving time"
        >
          {DETOUR_OPTIONS.map((m) => (
            <ToggleGroupItem key={m} value={String(m)} className="h-10 flex-1 px-0 tabular-nums" aria-label={`${m} minutes`}>
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="mt-1 text-xs text-muted-foreground">Minutes added to your trip, including getting back on route.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Food</legend>
        <RadioGroup
          value={prefs.diet}
          onValueChange={(v) => onPrefsChange({ ...prefs, diet: v as DietPreference })}
          className="grid grid-cols-3 gap-2"
          aria-label="Dietary preference"
        >
          {(Object.keys(DIET_LABELS) as DietPreference[]).map((d) => (
            <Label
              key={d}
              htmlFor={`diet-${d}`}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs font-normal leading-tight has-data-[state=checked]:border-primary has-data-[state=checked]:bg-secondary"
            >
              <RadioGroupItem id={`diet-${d}`} value={d} />
              {DIET_LABELS[d]}
            </Label>
          ))}
        </RadioGroup>
        {prefs.diet !== "any" && (
          <div className="mt-2 flex items-start gap-2">
            <Checkbox
              id="include-unconfirmed"
              checked={prefs.includeUnconfirmedDiet}
              onCheckedChange={(c) => onPrefsChange({ ...prefs, includeUnconfirmedDiet: c === true })}
              className="mt-0.5"
            />
            <Label htmlFor="include-unconfirmed" className="text-xs leading-snug font-normal text-muted-foreground">
              Also show places with no dietary information listed (marked as unconfirmed). Vegetarian status is only taken from
              listing data, never guessed from a name.
            </Label>
          </div>
        )}

        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-sm text-primary hover:underline">
            {prefs.cuisines.length ? `Cuisine: ${prefs.cuisines.join(", ")}` : "Filter by cuisine (optional)"}
          </summary>
          <ToggleGroup
            type="multiple"
            variant="outline"
            value={prefs.cuisines}
            onValueChange={(v) => onPrefsChange({ ...prefs, cuisines: v as CuisineId[] })}
            className="mt-2 flex w-full flex-wrap justify-start"
            aria-label="Cuisines"
          >
            {CUISINE_OPTIONS.map((c) => (
              <ToggleGroupItem key={c} value={c} size="sm" className="capitalize">
                {c}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="mt-1 text-xs text-muted-foreground">Only places whose listing mentions a chosen cuisine are shown.</p>
        </details>
      </fieldset>

      <div className="mt-1 flex gap-2">
        {loading ? (
          <Button type="button" variant="outline" onClick={props.onCancel} className="h-11 flex-1 md:h-10">
            Cancel search
          </Button>
        ) : (
          <Button type="submit" className="h-11 flex-1 text-sm md:h-10" aria-disabled={!canSubmit || undefined}>
            Find stops on my route
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={props.onReset} className="h-11 md:h-10" aria-label="Clear all trip details">
          <RotateCcw aria-hidden />
        </Button>
      </div>
    </form>
  );
}
