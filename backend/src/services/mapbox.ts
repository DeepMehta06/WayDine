import type { MapboxDirectionsResult } from "../types/index.js";

const MAPBOX_TOKEN = process.env.MAPBOX_SECRET_TOKEN;
const DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving";
const MATRIX_URL = "https://api.mapbox.com/directions-matrix/v1/mapbox/driving";
const SEARCHBOX_URL = "https://api.mapbox.com/search/searchbox/v1";

function assertToken(): string {
  if (!MAPBOX_TOKEN) {
    throw new Error("Missing MAPBOX_SECRET_TOKEN in backend/.env");
  }
  return MAPBOX_TOKEN;
}

/** Full driving route geometry + duration between two points. */
export async function getRoute(
  source: [number, number],
  destination: [number, number]
): Promise<MapboxDirectionsResult> {
  const token = assertToken();
  const coords = `${source[0]},${source[1]};${destination[0]},${destination[1]}`;
  const url = `${DIRECTIONS_URL}/${coords}?geometries=geojson&overview=full&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox Directions API failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    routes: Array<{
      geometry: { coordinates: [number, number][] };
      duration: number;
      distance: number;
    }>;
  };

  const route = data.routes[0];
  if (!route) {
    throw new Error("No route found between source and destination");
  }

  return {
    polyline: route.geometry.coordinates,
    durationSec: route.duration,
    distanceM: route.distance,
  };
}

/**
 * Pairwise driving-time matrix (seconds) between a small set of coordinates.
 * Used to build real edge weights for the candidate graph (max 25 points per Mapbox limits).
 */
export async function getDurationMatrix(
  coordinates: [number, number][]
): Promise<number[][]> {
  if (coordinates.length > 25) {
    throw new Error("Mapbox Matrix API supports at most 25 coordinates per request");
  }
  const token = assertToken();
  const coordsParam = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `${MATRIX_URL}/${coordsParam}?annotations=duration&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox Matrix API failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { durations: (number | null)[][] };
  return data.durations.map((row) => row.map((v) => v ?? Number.POSITIVE_INFINITY));
}

export interface RawOpeningPeriod {
  /** 0 = Sunday, matching JS Date#getDay(). */
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface RawPoi {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  cuisine: string | null;
  openingHours: RawOpeningPeriod[];
}

function formatMapboxTime(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00`;
}

function parseOpeningHours(metadata: unknown): RawOpeningPeriod[] {
  const periods = (
    metadata as {
      open_hours?: {
        periods?: Array<{ open?: { day: number; time: string }; close?: { day: number; time: string } }>;
      };
    }
  )?.open_hours?.periods;
  if (!Array.isArray(periods)) return [];

  return periods
    .filter((p) => p.open?.time && p.close?.time)
    .map((p) => ({
      weekday: p.open!.day,
      opens_at: formatMapboxTime(p.open!.time),
      closes_at: formatMapboxTime(p.close!.time),
    }));
}

/**
 * Restaurants near a point via Mapbox's Search Box category API — replaces the
 * curated-DB lookup so the pipeline works on any route, not just pre-seeded ones.
 */
export async function searchRestaurantsNear(point: [number, number], limit = 10): Promise<RawPoi[]> {
  const token = assertToken();
  const [lng, lat] = point;
  const delta = 0.03; // ~3km box around the sample point, keeps results tight to the route
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join(",");
  const url =
    `${SEARCHBOX_URL}/category/restaurant?access_token=${token}&proximity=${lng},${lat}` +
    `&bbox=${bbox}&limit=${limit}&language=en&country=in`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox Search Box category API failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    features: Array<{
      geometry: { coordinates: [number, number] };
      properties: { mapbox_id: string; name: string; poi_category?: string[]; metadata?: unknown };
    }>;
  };

  return data.features.map((f) => ({
    id: f.properties.mapbox_id,
    name: f.properties.name,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    cuisine: f.properties.poi_category?.find((c) => c !== "restaurant") ?? f.properties.poi_category?.[0] ?? null,
    openingHours: parseOpeningHours(f.properties.metadata),
  }));
}
