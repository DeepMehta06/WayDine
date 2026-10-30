import type { LngLat } from "../contract/api.js";
import { AppError } from "../errors.js";
import { haversineM } from "../lib/geo.js";
import { graphFromOsmJson } from "./osmExtract.js";
import type { RoadGraph } from "./roadGraph.js";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const LIMIT_BYTES = 30_000_000;
const MAX_TRIP_METRES = 200_000;

/** Fetch roads around a straight corridor between trip endpoints; no Google restaurant coordinates are sent. */
export async function fetchRoadGraph(source: LngLat, destination: LngLat, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RoadGraph> {
  if (haversineM(source, destination) > MAX_TRIP_METRES) throw new AppError("OUT_OF_COVERAGE", "This trip is too long for on-demand OSM graph preview. Use an appropriate regional road extract.");
  const [aLng, aLat] = source; const [bLng, bLat] = destination;
  const points = [aLat, aLng, bLat, bLng].map((value) => value.toFixed(5)).join(",");
  const query = `[out:json][timeout:25];way[highway](around:3000,${points})->.roads;(.roads;rel(bw.roads)[type=restriction];);(._;>;);out body;`;
  const timeout = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "WayDine/0.1 (https://github.com/DeepMehta06/WayDine)", "Accept": "application/json" }, body: new URLSearchParams({ data: query }).toString(), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch {
    if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
    throw new AppError(timeout.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE", "OpenStreetMap road data could not be retrieved. Try again later or use a local road extract.");
  }
  if (!response.ok || !response.body) throw new AppError("UPSTREAM_UNAVAILABLE", "OpenStreetMap road data could not be retrieved. Try again later or use a local road extract.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
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
    const graph = graphFromOsmJson(data);
    if (graph.nodes.size > 200_000) throw new AppError("OUT_OF_COVERAGE", "This area has too much road data for an on-demand preview. Use a regional road extract.");
    graph.warnings.push("Road data covers a limited corridor between your endpoints; valid roads outside it may be missing.");
    return graph;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
    throw new AppError(timeout.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE", "OpenStreetMap road data was incomplete or could not be read.");
  } finally { reader.releaseLock(); }
}
