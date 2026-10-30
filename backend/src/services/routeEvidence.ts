/** Conservative route evidence; no road-side or U-turn estimate proves road safety. */
import { z } from "zod";
import type { LngLat, RouteAssessment } from "../contract/api.js";
import { cumulativeDistances, haversineM } from "../lib/geo.js";
import type { DirectionsResult } from "../providers/mapbox.js";
import type { ViaRoute } from "./routing.js";

type Legs = DirectionsResult["routes"][number]["legs"];
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;
const angularDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function initialBearing(a: LngLat, b: LngLat): number | null {
  if (haversineM(a, b) < 2) return null;
  const dLng = radians(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(radians(b[1]));
  const x = Math.cos(radians(a[1])) * Math.sin(radians(b[1])) - Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(dLng);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

interface Projection { distance: number; along: number; bearing: number; side: number; fraction: number }

function projections(point: LngLat, line: LngLat[], cumulative: number[], radiusM: number): Projection[] {
  const out: Projection[] = [];
  const latMargin = radiusM / 110_000;
  const lngMargin = radiusM / (110_000 * Math.max(0.1, Math.cos(radians(point[1]))));
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!; const b = line[i + 1]!;
    // Skip remote segments before spherical calculations; keeps long routes tractable.
    if (point[0] < Math.min(a[0], b[0]) - lngMargin || point[0] > Math.max(a[0], b[0]) + lngMargin ||
        point[1] < Math.min(a[1], b[1]) - latMargin || point[1] > Math.max(a[1], b[1]) + latMargin) continue;
    const bearing = initialBearing(a, b);
    if (bearing === null) continue;
    const dx = (b[0] - a[0]) * Math.cos(radians((a[1] + b[1] + point[1]) / 3));
    const dy = b[1] - a[1];
    const px = (point[0] - a[0]) * Math.cos(radians((a[1] + b[1] + point[1]) / 3));
    const py = point[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / denominator));
    const projected: LngLat = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const cross = dx * py - dy * px;
    out.push({ distance: haversineM(point, projected), along: cumulative[i]! + t * (cumulative[i + 1]! - cumulative[i]!), bearing, side: Math.sign(cross), fraction: t });
  }
  return out;
}

function closestUnambiguous(point: LngLat, line: LngLat[], cumulative: number[], radiusM: number): Projection | null {
  const all = projections(point, line, cumulative, radiusM).sort((a, b) => a.distance - b.distance);
  const best = all[0];
  if (!best || best.distance > radiusM) return null;
  for (const other of all.slice(1)) {
    if (other.distance > best.distance + 3) break;
    // Repeated, overlapping or intersecting route segments can imply conflicting progress.
    if (Math.abs(other.along - best.along) > 100) return null;
    if (best.side && other.side && best.side !== other.side && angularDifference(best.bearing, other.bearing) >= 45) return null;
  }
  return best;
}

export function routeSide(point: LngLat, route: LngLat[]): Pick<RouteAssessment, "sideOfSelectedRoute" | "localBearingDegrees"> {
  if (route.length < 2) return { sideOfSelectedRoute: "unknown", localBearingDegrees: null };
  const nearest = closestUnambiguous(point, route, cumulativeDistances(route), 2000);
  if (!nearest) return { sideOfSelectedRoute: "unknown", localBearingDegrees: null };
  return {
    sideOfSelectedRoute: nearest.distance <= 10 ? "on-route" : nearest.side === 0 || nearest.fraction === 0 || nearest.fraction === 1 ? "unknown" : nearest.side > 0 ? "left" : "right",
    localBearingDegrees: Math.round(nearest.bearing) % 360,
  };
}

const maneuverSchema = z.object({ maneuver: z.object({ type: z.string().min(1), modifier: z.string().optional(), location: z.tuple([z.number().finite(), z.number().finite()]).optional() }) });
interface Turns { complete: boolean; locations: Array<LngLat | null> }

function turns(legs: Legs, expectedLegs: number): Turns {
  let complete = legs.length === expectedLegs;
  const locations: Array<LngLat | null> = [];
  for (const leg of legs) {
    if (!leg.steps?.length) { complete = false; continue; }
    for (const raw of leg.steps) {
      const step = maneuverSchema.safeParse(raw);
      if (!step.success) { complete = false; continue; }
      const maneuver = step.data.maneuver;
      if (!maneuver.modifier && maneuver.type !== "depart" && maneuver.type !== "arrive") complete = false;
      if (maneuver.modifier === "uturn" && (maneuver.type === "turn" || maneuver.type === "continue")) locations.push(maneuver.location ?? null);
    }
  }
  return { complete, locations };
}

export function assessTurns(baseline: Legs, via: Legs): RouteAssessment["uTurns"] {
  const original = turns(baseline, 1); const observed = turns(via, 2);
  const status = observed.locations.length ? "reported" : observed.complete ? "none-reported" : "unknown";
  let additionalToBaseline: RouteAssessment["uTurns"]["additionalToBaseline"] = "unknown";
  if (original.complete && observed.complete) {
    if (observed.locations.length > original.locations.length) additionalToBaseline = "possible";
    else if (!observed.locations.length) additionalToBaseline = "none-detected";
    else if (original.locations.every(Boolean) && observed.locations.every(Boolean)) {
      const unmatched = [...original.locations] as LngLat[];
      let added = false;
      for (const location of observed.locations as LngLat[]) {
        const index = unmatched.findIndex((candidate) => haversineM(candidate, location) <= 50);
        if (index < 0) added = true; else unmatched.splice(index, 1);
      }
      additionalToBaseline = added ? "possible" : "none-detected";
    }
  }
  return { status, count: observed.complete ? observed.locations.length : null, additionalToBaseline };
}

/** Uses the first leg's routed distance to locate the stop in a revisited via geometry. */
function stopPosition(via: ViaRoute, cumulative: number[]): number | null {
  const candidates = projections(via.stopOnRoad, via.geometry, cumulative, 50);
  if (!candidates.length) return null;
  const nearest = candidates.reduce((minimum, candidate) => Math.min(minimum, candidate.distance), Infinity);
  if (nearest > 40) return null;
  const nearby = candidates.filter((c) => c.distance <= nearest + 5).sort((a, b) => Math.abs(a.along - via.toStopDistanceM) - Math.abs(b.along - via.toStopDistanceM));
  const selected = nearby[0]!;
  if (Math.abs(selected.along - via.toStopDistanceM) > Math.max(200, via.toStopDistanceM * 0.05)) return null;
  const competitor = nearby.find((c) => Math.abs(c.along - selected.along) > 100 && Math.abs(Math.abs(c.along - via.toStopDistanceM) - Math.abs(selected.along - via.toStopDistanceM)) < 30);
  return competitor ? null : selected.along;
}

/** Binary search avoids rescanning long via geometries for each sample. */
function samplePoint(line: LngLat[], cumulative: number[], distanceM: number): LngLat {
  const target = Math.max(0, Math.min(cumulative[cumulative.length - 1]!, distanceM));
  let low = 1; let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle]! < target) low = middle + 1; else high = middle;
  }
  const a = line[low - 1]!; const b = line[low]!;
  const length = cumulative[low]! - cumulative[low - 1]!;
  const t = length === 0 ? 0 : (target - cumulative[low - 1]!) / length;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export function assessBackwardTravel(baseline: LngLat[], via: ViaRoute): RouteAssessment["backwardTravelNearStop"] {
  const unknown: RouteAssessment["backwardTravelNearStop"] = { status: "unknown", estimatedMetres: null };
  if (baseline.length < 2 || via.geometry.length < 2) return unknown;
  const baseCum = cumulativeDistances(baseline); const viaCum = cumulativeDistances(via.geometry);
  const stop = stopPosition(via, viaCum);
  if (stop === null) return unknown;
  const start = Math.max(0, stop - 1500); const end = Math.min(viaCum[viaCum.length - 1]!, stop + 1500);
  const intervals = Math.min(80, Math.max(1, Math.ceil((end - start) / 50)));
  const spacing = (end - start) / intervals;
  if (spacing < 2) return unknown;
  let previous: Projection | null = null; let backwards = 0; let covered = 0;
  for (let i = 0; i <= intervals; i++) {
    const point = samplePoint(via.geometry, viaCum, start + spacing * i);
    const projection = closestUnambiguous(point, baseline, baseCum, 65);
    if (!projection || projection.distance > 60) { previous = null; continue; }
    if (previous) {
      const delta = projection.along - previous.along;
      if (Math.abs(delta) <= spacing * 1.5 + 10) {
        covered += spacing;
        if (delta < 0) backwards -= delta;
      }
    }
    previous = projection;
  }
  if (backwards >= 200) return { status: "possible", estimatedMetres: Math.round(backwards / 10) * 10 };
  return covered >= Math.max(300, (end - start) * 0.5) ? { status: "not-detected", estimatedMetres: Math.round(backwards / 10) * 10 } : unknown;
}

export function assessDivergence(baseline: LngLat[], via: LngLat[]): RouteAssessment["routeDivergence"] {
  if (baseline.length < 2 || via.length < 2) return { status: "unknown", nearBaselineFraction: null };
  const cumulative = cumulativeDistances(via); const total = cumulative[cumulative.length - 1]!;
  if (total < 300) return { status: "unknown", nearBaselineFraction: null };
  const samples = Math.min(80, Math.max(5, Math.ceil(total / 250)));
  const baseCum = cumulativeDistances(baseline);
  let near = 0;
  for (let i = 0; i < samples; i++) {
    const p = samplePoint(via, cumulative, total * i / (samples - 1));
    if (projections(p, baseline, baseCum, 150).some((candidate) => candidate.distance <= 150)) near++;
  }
  const fraction = Math.round(100 * near / samples) / 100;
  return { status: fraction < 0.6 ? "possible" : "not-detected", nearBaselineFraction: fraction };
}

export function assessRoute(baseline: LngLat[], baselineLegs: Legs, via: ViaRoute, restaurant: LngLat): RouteAssessment {
  return { ...routeSide(restaurant, baseline), uTurns: assessTurns(baselineLegs, via.legs),
    backwardTravelNearStop: assessBackwardTravel(baseline, via), routeDivergence: assessDivergence(baseline, via.geometry) };
}
