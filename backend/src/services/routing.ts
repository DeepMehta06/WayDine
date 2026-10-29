/**
 * Access-aware routing evidence. Candidate stops are approached on the curb
 * (driving) side, so a stop that needs a U-turn or a long way round simply
 * costs more routed time; nothing is excluded from geometry alone.
 *
 * 1. Screening: rectangular Matrix requests (source -> stops + destination,
 *    stops -> destination). Estimates and their baseline come from the same
 *    service, so they are internally consistent.
 * 2. Verification: the shortlist is routed as complete source -> stop ->
 *    destination journeys with Directions and compared, in seconds, against
 *    the Directions baseline route.
 */
import type { LngLat } from "../contract/api.js";
import { AppError } from "../errors.js";
import { mapSettled } from "../lib/http.js";
import type { ProviderContext } from "../providers/context.js";
import { mapboxDirections, mapboxMatrix, MATRIX_MAX_COORDINATES, type DirectionsResult } from "../providers/mapbox.js";

export interface Screened {
  index: number;
  toStopSec: number | null;
  fromStopSec: number | null;
  /** null when either leg is unreachable. */
  estimatedExtraSec: number | null;
}

/** Each batch holds source + up to 23 stops + destination (25 coordinates). */
export const SCREEN_BATCH = MATRIX_MAX_COORDINATES - 2;

export async function screenByMatrix(
  ctx: ProviderContext,
  source: LngLat,
  destination: LngLat,
  stops: LngLat[],
  signal?: AbortSignal
): Promise<{ screened: Screened[]; elements: number }> {
  const screened: Screened[] = [];
  let elements = 0;
  for (let offset = 0; offset < stops.length; offset += SCREEN_BATCH) {
    const batch = stops.slice(offset, offset + SCREEN_BATCH);
    const coords: LngLat[] = [source, ...batch, destination];
    const stopIdx = batch.map((_, i) => i + 1);
    const destIdx = coords.length - 1;
    const approaches = coords.map((_, i) => (i === 0 || i === destIdx ? "unrestricted" : "curb")) as Array<"unrestricted" | "curb">;

    const [outbound, inbound] = await Promise.all([
      mapboxMatrix(ctx, coords, [0], [...stopIdx, destIdx], { approaches, signal }),
      mapboxMatrix(ctx, coords, stopIdx, [destIdx], { approaches, signal }),
    ]);
    elements += stopIdx.length + 1 + stopIdx.length;
    const direct = outbound[0]![stopIdx.length];
    if (direct === null || direct === undefined) {
      throw new AppError("NO_ROUTE", "No drivable route connects your start and destination.");
    }
    batch.forEach((_, i) => {
      const toStop = outbound[0]![i] ?? null;
      const fromStop = inbound[i]![0] ?? null;
      screened.push({
        index: offset + i,
        toStopSec: toStop,
        fromStopSec: fromStop,
        estimatedExtraSec: toStop === null || fromStop === null ? null : toStop + fromStop - direct,
      });
    });
  }
  return { screened, elements };
}

export interface ViaRoute {
  durationSec: number;
  distanceM: number;
  toStopSec: number;
  geometry: LngLat[];
  /** Straight-line distance between the requested stop coordinate and where routing reached the road. */
  snapDistanceM: number;
}

export function viaRouteFrom(result: DirectionsResult): ViaRoute {
  const route = result.routes[0]!;
  const firstLeg = route.legs[0];
  if (!firstLeg) throw new AppError("UPSTREAM_UNAVAILABLE", "Route details came back incomplete.");
  return {
    durationSec: route.duration,
    distanceM: route.distance,
    toStopSec: firstLeg.duration,
    geometry: route.geometry.coordinates,
    snapDistanceM: Math.round(result.waypoints[1]?.distance ?? 0),
  };
}

export async function verifyStops(
  ctx: ProviderContext,
  source: LngLat,
  destination: LngLat,
  stops: LngLat[],
  signal?: AbortSignal
): Promise<Array<{ ok: true; via: ViaRoute } | { ok: false; error: unknown }>> {
  const settled = await mapSettled(stops, 3, async (stop) => {
    const result = await mapboxDirections(ctx, [source, stop, destination], {
      approaches: ["unrestricted", "curb", "unrestricted"],
      signal,
    });
    return viaRouteFrom(result);
  });
  return settled.map((r) => {
    if (!r.ok && r.error instanceof AppError && r.error.code === "CANCELLED") throw r.error;
    return r.ok ? { ok: true as const, via: r.value } : { ok: false as const, error: r.error };
  });
}
