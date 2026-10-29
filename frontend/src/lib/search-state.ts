/**
 * Search lifecycle state and opt-in sharing. Nothing is persisted unless the
 * user explicitly copies a share link; the link lives only in the URL hash,
 * which browsers never send to servers.
 */
import { CUISINE_OPTIONS, type CuisineId, type DietPreference, type PlaceSuggestion } from "@contract";

export type { PlaceSuggestion };

export type SelectedPlace = Omit<PlaceSuggestion, "source"> & {
  /** Where the point came from: a search provider, the device, or a shared link. */
  source: PlaceSuggestion["source"] | "device" | "shared";
  /** True when the user dragged the pin away from the original point. */
  adjusted?: boolean;
};

export type DepartureChoice = { mode: "now" } | { mode: "at"; local: string };

export interface TripPreferences {
  departure: DepartureChoice;
  diet: DietPreference;
  includeUnconfirmedDiet: boolean;
  maxDetourMinutes: number;
  cuisines: CuisineId[];
}

export const DETOUR_OPTIONS = [2, 5, 10, 15, 20, 30] as const;

export const DEFAULT_PREFERENCES: TripPreferences = {
  departure: { mode: "now" },
  diet: "any",
  includeUnconfirmedDiet: false,
  maxDetourMinutes: 10,
  cuisines: [],
};

interface SharedTrip {
  v: 1;
  s: [number, number, string];
  d: [number, number, string];
  p: { dt: string | null; diet: DietPreference; u: boolean; m: number; c: CuisineId[] };
}

export function encodeTrip(source: SelectedPlace, destination: SelectedPlace, prefs: TripPreferences): string {
  const payload: SharedTrip = {
    v: 1,
    s: [round(source.coordinates[0]), round(source.coordinates[1]), source.name],
    d: [round(destination.coordinates[0]), round(destination.coordinates[1]), destination.name],
    p: {
      dt: prefs.departure.mode === "at" ? prefs.departure.local : null,
      diet: prefs.diet,
      u: prefs.includeUnconfirmedDiet,
      m: prefs.maxDetourMinutes,
      c: prefs.cuisines,
    },
  };
  return `#trip=${encodeURIComponent(JSON.stringify(payload))}`;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

function sharedPlace([lng, lat, name]: [number, number, string], key: string): SelectedPlace | null {
  if (![lng, lat].every(Number.isFinite) || typeof name !== "string" || !name.trim()) return null;
  return { id: `shared:${key}`, name: name.slice(0, 120), secondary: "From a shared link", kind: "address", coordinates: [lng, lat], source: "shared" };
}

export function decodeTrip(hash: string): { source: SelectedPlace; destination: SelectedPlace; prefs: TripPreferences } | null {
  const m = /^#trip=(.+)$/.exec(hash);
  if (!m) return null;
  try {
    const data = JSON.parse(decodeURIComponent(m[1]!)) as SharedTrip;
    if (data.v !== 1) return null;
    const source = sharedPlace(data.s, "s");
    const destination = sharedPlace(data.d, "d");
    if (!source || !destination) return null;
    const diet: DietPreference = ["any", "vegetarian-options", "pure-veg"].includes(data.p.diet) ? data.p.diet : "any";
    const detour = DETOUR_OPTIONS.includes(data.p.m as (typeof DETOUR_OPTIONS)[number]) ? data.p.m : DEFAULT_PREFERENCES.maxDetourMinutes;
    return {
      source,
      destination,
      prefs: {
        departure: data.p.dt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.p.dt) ? { mode: "at", local: data.p.dt } : { mode: "now" },
        diet,
        includeUnconfirmedDiet: Boolean(data.p.u),
        maxDetourMinutes: detour,
        cuisines: (Array.isArray(data.p.c) ? data.p.c : []).filter((c): c is CuisineId => (CUISINE_OPTIONS as readonly string[]).includes(c)),
      },
    };
  } catch {
    return null;
  }
}
