import { supabase } from "../db/supabaseClient.js";
import type { CandidateRestaurant, RoadSide } from "../types/index.js";

const ROUTE_BUFFER_METERS = 200;

function toLineStringWkt(polyline: [number, number][]): string {
  const points = polyline.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
  return `LINESTRING(${points})`;
}

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

/** Index of the closest point on the route polyline to a given restaurant location. */
function nearestRouteIndex(point: [number, number], polyline: [number, number][]): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(point, polyline[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Candidate restaurants within ROUTE_BUFFER_METERS of the route polyline,
 * via the restaurants_near_route Postgres RPC (ST_DWithin on a GiST index).
 */
export async function getCandidates(
  routePolyline: [number, number][]
): Promise<CandidateRestaurant[]> {
  const routeWkt = toLineStringWkt(routePolyline);

  const { data, error } = await supabase.rpc("restaurants_near_route", {
    route_wkt: routeWkt,
    radius_m: ROUTE_BUFFER_METERS,
  });

  if (error) {
    throw new Error(`restaurants_near_route RPC failed: ${error.message}`);
  }

  type RpcRow = {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    highway_id: string;
    side: RoadSide;
    cuisine: string | null;
    veg_available: boolean;
    road_access_verified: boolean;
    distance_from_road_m: number;
  };

  return ((data ?? []) as RpcRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    highway_id: row.highway_id,
    side: row.side,
    cuisine: row.cuisine,
    veg_available: row.veg_available,
    road_access_verified: row.road_access_verified,
    distanceFromRoadM: Math.round(row.distance_from_road_m),
    nearestRouteIndex: nearestRouteIndex([row.longitude, row.latitude], routePolyline),
  }));
}
