import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { PlaceAutocomplete } from "@/components/PlaceAutocomplete";
import type { PlaceSuggestion } from "@/lib/mapbox";
import type { RecommendPreferences } from "@/types";

export interface SearchSubmitValue {
  source: [number, number];
  destination: [number, number];
  departureTime: Date;
  preferences: RecommendPreferences;
}

interface SearchFormProps {
  onSubmit: (value: SearchSubmitValue) => void;
  loading: boolean;
}

export function SearchForm({ onSubmit, loading }: SearchFormProps) {
  const [source, setSource] = useState<PlaceSuggestion | null>(null);
  const [destination, setDestination] = useState<PlaceSuggestion | null>(null);
  const [departureTime, setDepartureTime] = useState("");
  const [vegetarian, setVegetarian] = useState(false);
  const [maxDetourMinutes, setMaxDetourMinutes] = useState(15);

  const canSubmit = Boolean(source && destination && departureTime);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !destination || !departureTime) return;

    onSubmit({
      source: source.center,
      destination: destination.center,
      departureTime: new Date(departureTime),
      preferences: { vegetarian, maxDetourMinutes },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PlaceAutocomplete
        id="source"
        label="Starting from"
        placeholder="e.g. Mumbai"
        onSelect={setSource}
      />
      <PlaceAutocomplete
        id="destination"
        label="Driving to"
        placeholder="e.g. Pune"
        onSelect={setDestination}
      />

      <div>
        <Label htmlFor="departure" className="mb-1.5 block text-sm font-medium">
          Leaving at
        </Label>
        <Input
          id="departure"
          type="datetime-local"
          value={departureTime}
          onChange={(e) => setDepartureTime(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5">
        <Label htmlFor="vegetarian" className="text-sm font-medium">
          Vegetarian only
        </Label>
        <Switch id="vegetarian" checked={vegetarian} onCheckedChange={setVegetarian} />
      </div>

      <div>
        <Label htmlFor="detour" className="mb-1.5 block text-sm font-medium">
          Max detour: {maxDetourMinutes} min
        </Label>
        <input
          id="detour"
          type="range"
          min={5}
          max={30}
          step={5}
          value={maxDetourMinutes}
          onChange={(e) => setMaxDetourMinutes(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      <Button type="submit" disabled={!canSubmit || loading} className="mt-1">
        {loading ? "Finding stops…" : "Find stops on my route"}
      </Button>
    </form>
  );
}
