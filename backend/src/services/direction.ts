import type { CandidateRestaurant, DirectionClassifiedRestaurant, RoadSide } from "../types/index.js";

/**
 * Classifies each candidate as left/right of the vehicle's actual direction of
 * travel at that point on the route, via a 2D cross product of the local travel
 * vector and the vector from the route to the restaurant. India drives on the
 * left, so "left of travel direction" is reachable without crossing the
 * opposing carriageway; "right" requires a U-turn/median crossing.
 */
export function classifyDirection(
  candidates: CandidateRestaurant[],
  routePolyline: [number, number][]
): DirectionClassifiedRestaurant[] {
  return candidates.map((candidate) => {
    const idx = candidate.nearestRouteIndex;
    const prevIdx = Math.max(0, idx - 1);
    const nextIdx = Math.min(routePolyline.length - 1, idx + 1);
    const [pLng, pLat] = routePolyline[prevIdx]!;
    const [nLng, nLat] = routePolyline[nextIdx]!;
    const [rLng, rLat] = routePolyline[idx]!;

    const travelVec = { x: nLng - pLng, y: nLat - pLat };
    const toRestaurantVec = { x: candidate.longitude - rLng, y: candidate.latitude - rLat };

    const cross = travelVec.x * toRestaurantVec.y - travelVec.y * toRestaurantVec.x;
    const travelSide: RoadSide = cross > 0 ? "left" : "right";

    return {
      ...candidate,
      travelSide,
      matchesRouteDirection: travelSide === "left",
    };
  });
}
