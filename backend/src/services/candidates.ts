import { searchRestaurantsNear } from "./mapbox.js";
import type { CandidateRestaurant } from "../types/index.js";

// Live POI coordinates are less precise than surveyed data, so the buffer is
// wider than the original curated-DB radius (200m).
const ROUTE_BUFFER_METERS = 400;
const SAMPLE_INTERVAL_METERS = 15000;
const MAX_SAMPLES = 8;
// Mapbox Matrix API caps at 25 coordinates per call; graph.ts reserves 2 for source/destination.
const MAX_CANDIDATES = 23;

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const la1 = (lat1 * Math.PI) / 180;
  const la2 = (lat2 * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Closest point on the route polyline to a given location, with its distance. */
function nearestRoutePoint(
  point: [number, number],
  polyline: [number, number][]
): { index: number; distanceM: number } {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(point, polyline[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distanceM: bestDist };
}

/** Points roughly every SAMPLE_INTERVAL_METERS along the route, capped at MAX_SAMPLES. */
function sampleRoutePoints(polyline: [number, number][]): [number, number][] {
  if (polyline.length === 0) return [];

  const samples: [number, number][] = [polyline[0]!];
  let accDist = 0;
  for (let i = 1; i < polyline.length && samples.length < MAX_SAMPLES; i++) {
    accDist += haversineMeters(polyline[i - 1]!, polyline[i]!);
    if (accDist >= SAMPLE_INTERVAL_METERS) {
      samples.push(polyline[i]!);
      accDist = 0;
    }
  }

  const last = polyline[polyline.length - 1]!;
  if (samples.length < MAX_SAMPLES && samples[samples.length - 1] !== last) {
    samples.push(last);
  }
  return samples;
}

/**
 * Candidate restaurants within ROUTE_BUFFER_METERS of the route, sourced live
 * from Mapbox's Search Box category API at points sampled along the polyline
 * (replaces the curated-DB ST_DWithin lookup so any route works, not just a
 * pre-seeded corridor).
 */
export async function getCandidates(
  routePolyline: [number, number][]
): Promise<CandidateRestaurant[]> {
  const samples = sampleRoutePoints(routePolyline);
  const results = await Promise.all(samples.map((pt) => searchRestaurantsNear(pt)));

  const byId = new Map<string, CandidateRestaurant>();
  for (const pois of results) {
    for (const poi of pois) {
      if (byId.has(poi.id)) continue;

      const { index, distanceM } = nearestRoutePoint([poi.longitude, poi.latitude], routePolyline);
      if (distanceM > ROUTE_BUFFER_METERS) continue;

      byId.set(poi.id, {
        id: poi.id,
        name: poi.name,
        latitude: poi.latitude,
        longitude: poi.longitude,
        cuisine: poi.cuisine,
        vegAvailable: null,
        distanceFromRoadM: Math.round(distanceM),
        nearestRouteIndex: index,
      });
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => a.distanceFromRoadM - b.distanceFromRoadM)
    .slice(0, MAX_CANDIDATES);
}
