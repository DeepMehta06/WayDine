/** Google Routes adapter. No Places API calls or automatic retries. */
import { z } from "zod";
import type { LngLat } from "../contract/api.js";
import { AppError } from "../errors.js";
import { fetchJson } from "../lib/http.js";
import type { ProviderContext } from "./context.js";
import type { DirectionsResult } from "./mapbox.js";

const number = z.number().finite();
const latLng = z.object({ latitude: number, longitude: number });
const location = z.object({ latLng });
const seconds = z.string().regex(/^\d+(?:\.\d+)?s$/).transform((value) => Number(value.slice(0, -1)));
const leg = z.object({ duration: seconds, distanceMeters: number.nonnegative(), endLocation: location, steps: z.array(z.object({ navigationInstruction: z.object({ maneuver: z.string().optional() }).optional(), startLocation: location.optional() })).optional() });
const route = z.object({ duration: seconds, distanceMeters: number.nonnegative(), description: z.string().optional(), polyline: z.object({ geoJsonLinestring: z.object({ coordinates: z.array(z.tuple([number, number])).min(2) }) }), legs: z.array(leg).min(1) });
const directionsSchema = z.object({ routes: z.array(route).default([]) });
const matrixSchema = z.array(z.object({ originIndex: z.number().int().nonnegative().default(0), destinationIndex: z.number().int().nonnegative().default(0), condition: z.string().optional(), status: z.object({ code: z.number().optional() }).optional(), duration: seconds.optional() }));
const coords = (p: { latitude: number; longitude: number }): LngLat => [p.longitude, p.latitude];
const waypoint = ([lng, lat]: LngLat, sideOfRoad = false) => ({ location: { latLng: { latitude: lat, longitude: lng } }, ...(sideOfRoad ? { sideOfRoad: true } : {}) });
function key(ctx: ProviderContext): string {
  if (!ctx.googleRoutesKey) throw new AppError("NOT_CONFIGURED", "Google Routes is not configured on this server.");
  return ctx.googleRoutesKey;
}

export async function googleDirections(ctx: ProviderContext, points: LngLat[], opts: { alternatives?: boolean; signal?: AbortSignal }): Promise<DirectionsResult> {
  const data = await fetchJson({
    url: "https://routes.googleapis.com/directions/v2:computeRoutes", schema: directionsSchema, provider: "google-routes", quota: ctx.quota,
    budget: { bucket: "google_routes", units: 1 }, method: "POST", retries: 0, fetchImpl: ctx.fetchImpl, signal: opts.signal, logResponseBody: false,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key(ctx), "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.description,routes.polyline.geoJsonLinestring,routes.legs.duration,routes.legs.distanceMeters,routes.legs.endLocation,routes.legs.steps.navigationInstruction.maneuver,routes.legs.steps.startLocation" },
    body: JSON.stringify({ origin: waypoint(points[0]!), destination: waypoint(points[points.length - 1]!), ...(points.length > 2 ? { intermediates: points.slice(1, -1).map((p) => waypoint(p, true)) } : {}), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", computeAlternativeRoutes: Boolean(opts.alternatives && points.length === 2), polylineEncoding: "GEO_JSON_LINESTRING", polylineQuality: "HIGH_QUALITY" }),
  });
  if (!data.routes.length) throw new AppError("NO_ROUTE", "No drivable route connects these points.");
  if (data.routes.some((r) => r.legs.length !== points.length - 1)) throw new AppError("UPSTREAM_UNAVAILABLE", "Route details came back incomplete.");
  const routes = data.routes.map((r) => ({ duration: r.duration, distance: r.distanceMeters, geometry: { coordinates: r.polyline.geoJsonLinestring.coordinates }, legs: r.legs.map((l) => ({ duration: l.duration, distance: l.distanceMeters, summary: r.description, ...(l.steps ? { steps: l.steps.map((s) => ({ maneuver: { type: "turn", ...(s.navigationInstruction?.maneuver ? { modifier: s.navigationInstruction.maneuver.startsWith("UTURN_") ? "uturn" : "straight" } : {}), ...(s.startLocation ? { location: coords(s.startLocation.latLng) } : {}) } })) } : {}) })) }));
  const first = data.routes[0]!;
  return { code: "Ok", routes, waypoints: [ { location: points[0]! }, ...first.legs.map((l) => ({ location: coords(l.endLocation.latLng) })) ] };
}

export async function googleMatrix(ctx: ProviderContext, points: LngLat[], sources: number[], destinations: number[], opts: { approaches?: Array<"unrestricted" | "curb">; signal?: AbortSignal }): Promise<Array<Array<number | null>>> {
  const data = await fetchJson({
    url: "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", schema: matrixSchema, provider: "google-route-matrix", quota: ctx.quota,
    budget: { bucket: "google_route_matrix_elements", units: sources.length * destinations.length }, method: "POST", retries: 0, fetchImpl: ctx.fetchImpl, signal: opts.signal, logResponseBody: false,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key(ctx), "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,duration" },
    body: JSON.stringify({ origins: sources.map((i) => ({ waypoint: waypoint(points[i]!, opts.approaches?.[i] === "curb") })), destinations: destinations.map((i) => ({ waypoint: waypoint(points[i]!, opts.approaches?.[i] === "curb") })), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
  });
  const matrix: Array<Array<number | null | undefined>> = sources.map(() => Array(destinations.length).fill(undefined));
  for (const entry of data) {
    if (!matrix[entry.originIndex] || entry.destinationIndex >= destinations.length || matrix[entry.originIndex]![entry.destinationIndex] !== undefined) throw new AppError("UPSTREAM_UNAVAILABLE", "Travel-time estimates came back incomplete.");
    if (entry.status?.code) throw new AppError("UPSTREAM_UNAVAILABLE", "Travel-time estimates are unavailable right now.");
    if (entry.condition === "ROUTE_NOT_FOUND") matrix[entry.originIndex]![entry.destinationIndex] = null;
    else if (entry.condition === "ROUTE_EXISTS" && entry.duration !== undefined) matrix[entry.originIndex]![entry.destinationIndex] = entry.duration;
    else throw new AppError("UPSTREAM_UNAVAILABLE", "Travel-time estimates came back incomplete.");
  }
  if (matrix.some((row) => row.some((value) => value === undefined))) throw new AppError("UPSTREAM_UNAVAILABLE", "Travel-time estimates came back incomplete.");
  return matrix as Array<Array<number | null>>;
}
