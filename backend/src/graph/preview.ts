import { readFile, stat } from "node:fs/promises";
import type { LngLat } from "../contract/api.js";
import { AppError } from "../errors.js";
import { graphFromOsmJson } from "./osmExtract.js";
import { snapToRoad } from "./snap.js";
import { shortestPath } from "./shortestPath.js";
import type { RoadGraph } from "./roadGraph.js";

export interface GraphPreview { geometry: LngLat[]; distanceM: number; durationSec: number; snapDistancesM: number[]; warnings: string[]; attribution: string }

export function makeGraphPreview(graph: RoadGraph, source: LngLat, destination: LngLat, stop?: LngLat): GraphPreview {
  // Find all snap points in one graph; split edges preserve direction and turn rules.
  let working = graph;
  const nodes: number[] = []; const distances: number[] = []; let ambiguous = false;
  for (const point of [source, destination, ...(stop ? [stop] : [])]) {
    const result = snapToRoad(working, point, 50);
    if (!result) throw new AppError("NO_ROUTE", "A trip point is more than 50 m from a road in the loaded OSM data.");
    working = result.graph; nodes.push(result.node); distances.push(Math.round(result.distanceM)); ambiguous ||= result.ambiguous;
  }
  const path = shortestPath(working, nodes[0]!, nodes[1]!, nodes[2]);
  if (!path || path.nodes.length < 2) throw new AppError("NO_ROUTE", "No route was found in the loaded OSM road extract.");
  const geometry = path.nodes.map((id) => working.nodes.get(id)!);
  return { geometry, distanceM: Math.round(path.distanceM), durationSec: Math.round(path.seconds), snapDistancesM: distances,
    warnings: [...graph.warnings, ...(ambiguous ? ["Some trip points have multiple nearby roads; the selected road may be wrong."] : []), "WayDine graph route is a planning estimate. Road access, traffic, closures and turns may be incomplete. Google Maps directions can differ."],
    attribution: "© OpenStreetMap contributors" };
}

/** The configured local file is loaded once; it is never requested from Google. */
export function createGraphLoader(path?: string): () => Promise<RoadGraph> {
  let cached: Promise<RoadGraph> | undefined;
  return () => {
    if (!path) throw new AppError("NOT_CONFIGURED", "WayDine graph preview needs an OSM JSON road extract configured on the server.");
    if (!cached) cached = (async () => {
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size > 30_000_000) throw new Error("invalid extract size");
        const graph = graphFromOsmJson(JSON.parse(await readFile(path, "utf8")));
        if (graph.nodes.size > 200_000) throw new Error("extract too large");
        return graph;
      } catch { throw new AppError("NOT_CONFIGURED", "The configured OSM road extract could not be loaded. Check its path, format and size."); }
    })().catch((error: unknown) => { cached = undefined; throw error; });
    return cached;
  };
}
