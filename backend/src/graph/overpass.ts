import type { LngLat } from "../contract/api.js";
import { AppError } from "../errors.js";
import { haversineM } from "../lib/geo.js";
import { log } from "../lib/log.js";
import { graphFromOsmJson } from "./osmExtract.js";
import type { RoadGraph } from "./roadGraph.js";

// Public instances are tried in order; each is rate limited and sometimes overloaded.
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const SERVER_TIMEOUT_S = 60;
const CLIENT_TIMEOUT_MS = 75_000;
export const CORRIDOR_M = 1500;
// Drivable classes only: footways, paths and cycleways dominate the payload and are never routed.
const DRIVABLE = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$";
const LIMIT_BYTES = 30_000_000;
export const MAX_TRIP_METRES = 200_000;
const MAX_NODES = 200_000;

/** Overpass `around` accepts a polyline of lat,lon pairs and matches ways within the radius of any segment. */
export function corridorQuery(points: LngLat[], decimals = 5): string {
  const list = points.map(([lng, lat]) => `${lat.toFixed(decimals)},${lng.toFixed(decimals)}`).join(",");
  return `[out:json][timeout:${SERVER_TIMEOUT_S}];way[highway~"${DRIVABLE}"](around:${CORRIDOR_M},${list})->.roads;(.roads;rel(bw.roads)[type=restriction];);(._;>;);out body;`;
}

/** Downloads the raw OSM JSON for a corridor. Tries each public instance before giving up. */
export async function fetchOverpassJson(query: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const body = new URLSearchParams({ data: query }).toString();
  const unavailable = () => new AppError("UPSTREAM_UNAVAILABLE", "OpenStreetMap road data could not be retrieved. Try again later or use a local road extract.");
  let response: Response | undefined;
  let timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  let timedOut = false;
  for (const endpoint of ENDPOINTS) {
    timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
    try {
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "WayDine/0.1 (https://github.com/DeepMehta06/WayDine)", "Accept": "application/json" }, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (res.ok && res.body) { response = res; break; }
      log("warn", "overpass.http_error", { endpoint, status: res.status });
      await res.body?.cancel().catch(() => undefined);
    } catch {
      if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
      timedOut = timeout.aborted;
      log("warn", "overpass.request_failed", { endpoint, timedOut });
    }
  }
  if (!response) throw timedOut ? new AppError("UPSTREAM_TIMEOUT", "OpenStreetMap road data took too long to download. Try again, or use a shorter trip or a local road extract.") : unavailable();
  const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LIMIT_BYTES) { await reader.cancel(); throw new AppError("OUT_OF_COVERAGE", "This area has too much road data for an on-demand preview. Use a regional road extract."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (data && typeof data === "object" && "remark" in data) throw new Error("Overpass reported an incomplete result");
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
    throw new AppError(timeout.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE", "OpenStreetMap road data was incomplete or could not be read.");
  } finally { reader.releaseLock(); }
}

/** Builds the graph and enforces the size ceiling; unreadable extracts are reported as an upstream problem. */
export function corridorGraph(data: unknown): RoadGraph {
  let graph: RoadGraph;
  try { graph = graphFromOsmJson(data); }
  catch { throw new AppError("UPSTREAM_UNAVAILABLE", "OpenStreetMap road data was incomplete or could not be read."); }
  if (graph.nodes.size > MAX_NODES) throw new AppError("OUT_OF_COVERAGE", "This area has too much road data for an on-demand preview. Use a regional road extract.");
  graph.warnings.push("Road data covers a limited corridor between your endpoints; valid roads outside it may be missing.");
  return graph;
}

/** Fetch roads around a straight corridor between trip endpoints; no Google restaurant coordinates are sent. */
export async function fetchRoadGraph(source: LngLat, destination: LngLat, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RoadGraph> {
  if (haversineM(source, destination) > MAX_TRIP_METRES) throw new AppError("OUT_OF_COVERAGE", "This trip is too long for on-demand OSM graph preview. Use an appropriate regional road extract.");
  return corridorGraph(await fetchOverpassJson(corridorQuery([source, destination]), fetchImpl, signal));
}
