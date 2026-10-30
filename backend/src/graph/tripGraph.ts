/**
 * Supplies the road graph for a trip. Two sources:
 *  - file: a regional OSM extract loaded once (see README "Overpass Turbo");
 *  - overpass: the corridor around the route is downloaded once, written to
 *    disk, and every later search for the same corridor reads the file.
 * OSM data is ODbL, so caching it is permitted; no Google content is stored.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LngLat } from "../contract/api.js";
import { AppError } from "../errors.js";
import { cumulativeDistances, simplifyLine } from "../lib/geo.js";
import { log } from "../lib/log.js";
import { corridorGraph, corridorQuery, fetchOverpassJson, MAX_TRIP_METRES } from "./overpass.js";
import { createGraphLoader } from "./preview.js";
import type { RoadGraph } from "./roadGraph.js";

export type TripGraphLoader = (route: LngLat[], signal?: AbortSignal) => Promise<RoadGraph>;

const MAX_QUERY_POINTS = 60;
const KEY_DECIMALS = 3;
const MEMORY_GRAPHS = 3;

/** Few enough vertices for a compact query, close enough to the route that the buffer covers its curves. */
export function corridorPoints(route: LngLat[]): LngLat[] {
  let tolerance = 0.0003;
  let points = simplifyLine(route, tolerance);
  while (points.length > MAX_QUERY_POINTS) { tolerance *= 1.6; points = simplifyLine(route, tolerance); }
  return points;
}

export function createTripGraphLoader(opts: { source: "file" | "overpass"; path?: string; cacheDir: string; fetchImpl: typeof fetch }): TripGraphLoader {
  if (opts.source === "file") {
    const load = createGraphLoader(opts.path);
    return () => load();
  }
  const memory = new Map<string, RoadGraph>();
  const pending = new Map<string, Promise<RoadGraph>>();
  // Public Overpass servers expect one heavy request at a time from a client.
  let queue: Promise<unknown> = Promise.resolve();

  const obtain = async (key: string, query: string, signal?: AbortSignal): Promise<RoadGraph> => {
    const file = join(opts.cacheDir, `${key}.json`);
    try {
      const graph = corridorGraph(JSON.parse(await readFile(file, "utf8")));
      log("info", "graph.cache_hit", { key });
      return graph;
    } catch { /* missing or unreadable cache entries are simply refetched */ }
    const data = await fetchOverpassJson(query, opts.fetchImpl, signal);
    const graph = corridorGraph(data);
    try { await mkdir(opts.cacheDir, { recursive: true }); await writeFile(file, JSON.stringify(data)); log("info", "graph.cache_write", { key }); }
    catch { log("warn", "graph.cache_write_failed", { key }); }
    return graph;
  };

  return (route, signal) => {
    const cumulative = cumulativeDistances(route);
    if ((cumulative[cumulative.length - 1] ?? 0) > MAX_TRIP_METRES * 1.5) {
      return Promise.reject(new AppError("OUT_OF_COVERAGE", "This route is too long for an on-demand road download. Use a regional road extract."));
    }
    const query = corridorQuery(corridorPoints(route), KEY_DECIMALS);
    const key = createHash("sha256").update(query).digest("hex").slice(0, 32);
    const hit = memory.get(key);
    if (hit) return Promise.resolve(hit);
    let run = pending.get(key);
    if (!run) {
      const turn = queue.then(() => obtain(key, query, signal));
      queue = turn.catch(() => undefined);
      run = turn.then((graph) => {
        memory.set(key, graph);
        while (memory.size > MEMORY_GRAPHS) memory.delete(memory.keys().next().value!);
        return graph;
      }).finally(() => pending.delete(key));
      pending.set(key, run);
    }
    return run;
  };
}
