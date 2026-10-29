import type { MapboxDirectionsResult } from "../types/index.js";

const MAPBOX_TOKEN = process.env.MAPBOX_SECRET_TOKEN;
const DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving";
const MATRIX_URL = "https://api.mapbox.com/directions-matrix/v1/mapbox/driving";

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
