/**
 * Route geometry. Distances use a local equirectangular projection per
 * segment, accurate to well under 1% at the sub-5km scales used here.
 * Coordinates are [lng, lat].
 */
export type LngLat = [number, number];

const R = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RoutePosition {
  /** Perpendicular (segment-aware) distance from the point to the route. */
  distanceM: number;
  /** Index of the segment start vertex the projection lies on. */
  segmentIndex: number;
  /** Distance along the route from its start to the projected point. */
  alongM: number;
  projected: LngLat;
}

export function cumulativeDistances(line: LngLat[]): number[] {
  const out = new Array<number>(line.length);
  out[0] = 0;
  for (let i = 1; i < line.length; i++) out[i] = out[i - 1]! + haversineM(line[i - 1]!, line[i]!);
  return out;
}

/** Nearest point on the polyline (not merely the nearest vertex). */
export function positionOnRoute(point: LngLat, line: LngLat[], cumulative = cumulativeDistances(line)): RoutePosition {
  if (line.length === 0) throw new Error("positionOnRoute requires a non-empty line");
  if (line.length === 1) {
    return { distanceM: haversineM(point, line[0]!), segmentIndex: 0, alongM: 0, projected: line[0]! };
  }
  let best: RoutePosition | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const kx = Math.cos(toRad((a[1] + b[1] + point[1]) / 3)) * (Math.PI / 180) * R;
    const ky = (Math.PI / 180) * R;
    const bx = (b[0] - a[0]) * kx;
    const by = (b[1] - a[1]) * ky;
    const px = (point[0] - a[0]) * kx;
    const py = (point[1] - a[1]) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const dx = px - t * bx;
    const dy = py - t * by;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.distanceM) {
      const segLen = cumulative[i + 1]! - cumulative[i]!;
      best = {
        distanceM: d,
        segmentIndex: i,
        alongM: cumulative[i]! + t * segLen,
        projected: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      };
    }
  }
  return best!;
}

/** Point at a given distance along the route. */
export function pointAlong(line: LngLat[], cumulative: number[], distanceM: number): LngLat {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const target = Math.max(0, Math.min(total, distanceM));
  let i = 1;
  while (i < cumulative.length && cumulative[i]! < target) i++;
  if (i >= line.length) return line[line.length - 1]!;
  const a = line[i - 1]!;
  const b = line[i]!;
  const segLen = cumulative[i]! - cumulative[i - 1]!;
  const t = segLen === 0 ? 0 : (target - cumulative[i - 1]!) / segLen;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export interface CorridorSearchPlan {
  centers: LngLat[];
  /** Along-route position of each centre. */
  centersAlongM: number[];
  radiusM: number;
  spacingM: number;
  routeLengthM: number;
}

/**
 * Circles of radius r spaced s apart along a route cover the whole band of
 * half-width w when s <= 2*sqrt(r^2 - w^2). Centres span the entire route
 * (both ends always included). When the circle budget is too small for the
 * route length, the radius grows instead of leaving gaps, so geometric
 * coverage is always complete; recall in dense areas is then limited by
 * provider page size, which discovery detects and refines.
 */
export function planCorridorSearch(line: LngLat[], halfWidthM: number, maxCircles: number): CorridorSearchPlan {
  if (maxCircles < 2) throw new Error("planCorridorSearch needs at least 2 circles");
  const cumulative = cumulativeDistances(line);
  const length = cumulative[cumulative.length - 1] ?? 0;
  const minRadius = halfWidthM * 1.25;
  const minRadiusSpacing = 2 * Math.sqrt(minRadius ** 2 - halfWidthM ** 2);
  const needed = Math.max(2, Math.ceil(length / minRadiusSpacing) + 1);
  const count = Math.min(maxCircles, needed);
  const spacingM = length / (count - 1);
  const radiusM = Math.max(minRadius, Math.sqrt((spacingM / 2) ** 2 + halfWidthM ** 2));
  const centersAlongM = Array.from({ length: count }, (_, k) => k * spacingM);
  const centers = centersAlongM.map((d) => pointAlong(line, cumulative, d));
  return { centers, centersAlongM, radiusM, spacingM, routeLengthM: length };
}

export type BBox = [number, number, number, number];

export function bboxAround([lng, lat]: LngLat, radiusM: number): BBox {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos(toRad(lat)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

export function quadrants([minLng, minLat, maxLng, maxLat]: BBox): BBox[] {
  const midLng = (minLng + maxLng) / 2;
  const midLat = (minLat + maxLat) / 2;
  return [
    [minLng, minLat, midLng, midLat],
    [midLng, minLat, maxLng, midLat],
    [minLng, midLat, midLng, maxLat],
    [midLng, midLat, maxLng, maxLat],
  ];
}

export function bboxCenter([minLng, minLat, maxLng, maxLat]: BBox): LngLat {
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

/** Ramer–Douglas–Peucker simplification for display payloads (tolerance in degrees). */
export function simplifyLine(line: LngLat[], tolerance = 0.00003): LngLat[] {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = line[start]!;
    const [bx, by] = line[end]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = line[i]!;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxDist > tolerance) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

/** India bounding box used to enforce the app's documented geographic scope. */
export const INDIA_BBOX = { minLng: 68.0, minLat: 6.5, maxLng: 97.5, maxLat: 35.7 };

export function inIndia([lng, lat]: LngLat): boolean {
  return lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng && lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat;
}
