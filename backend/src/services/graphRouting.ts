/**
 * WayDine's own routing engine. The trip's road graph (OpenStreetMap) is
 * built once per search; the start and destination are snapped onto it, and
 * every candidate stop is evaluated with Dijkstra's algorithm:
 *
 *   detour = shortest(start -> stop -> destination) - shortest(start -> destination)
 *
 * Both costs use the same graph, edge weights, one-way rules and turn
 * restrictions, so the difference is a like-for-like detour. A turn-around
 * (leaving a road in the direction it was just entered) is counted as a
 * U-turn, and the via path is compared with the baseline path to find
 * backward travel. No external routing service is involved here.
 */
import type { LngLat, RouteAssessment } from "../contract/api.js";
import { AppError } from "../errors.js";
import { shortestPath } from "../graph/shortestPath.js";
import { snapToRoad } from "../graph/snap.js";
import type { RoadEdge, RoadGraph } from "../graph/roadGraph.js";
import { assessBackwardTravel, assessDivergence, routeSide } from "./routeEvidence.js";
import type { ViaRoute } from "./routing.js";

export const ENDPOINT_SNAP_M = 100;
export const STOP_SNAP_M = 75;
/** A route is only trusted when the loaded road data spans (nearly) all of it. */
export const MIN_ROUTE_COVERAGE = 0.95;

/** Nobody parks on a motorway carriageway; stops snap to the access road beside it. */
const drivableForStops = (edge: RoadEdge) => edge.highway !== "motorway" && edge.highway !== "motorway_link";

export interface GraphStop {
  /** Seconds in the graph's own (estimated-speed) time model. */
  extraSec: number;
  extraM: number;
  viaSec: number;
  viaM: number;
  toStopSec: number;
  toStopM: number;
  geometry: LngLat[];
  stopOnRoad: LngLat;
  snapDistanceM: number;
  ambiguousSnap: boolean;
  uTurns: number;
  assessment: RouteAssessment;
}

export type GraphStopResult = { ok: true; stop: GraphStop } | { ok: false; reason: "no-road" | "no-path" };

export interface GraphTrip {
  nodes: number;
  baseline: { sec: number; m: number; geometry: LngLat[]; uTurns: number };
  snapM: { source: number; destination: number };
  warnings: string[];
  evaluate(stop: LngLat): GraphStopResult;
}

/**
 * Counts reversals onto the road just travelled. Turning around at a dead end,
 * or at the stop itself, is simply leaving the way you came, so only
 * reversals at a through-junction (where another way on existed) are U-turns.
 */
export function countUTurns(edges: RoadEdge[], graph: RoadGraph, stopNode?: number): number {
  let turns = 0;
  for (let i = 1; i < edges.length; i++) {
    const arrive = edges[i - 1]!, leave = edges[i]!;
    if (leave.from !== arrive.to || leave.to !== arrive.from || leave.from === stopNode) continue;
    if ((graph.outgoing.get(leave.from) ?? []).some((edge) => edge.to !== arrive.from)) turns++;
  }
  return turns;
}

const bounds = new WeakMap<RoadGraph, [number, number, number, number]>();
function graphBounds(graph: RoadGraph): [number, number, number, number] {
  let box = bounds.get(graph);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lng, lat] of graph.nodes.values()) {
      if (lng < box[0]) box[0] = lng; if (lat < box[1]) box[1] = lat;
      if (lng > box[2]) box[2] = lng; if (lat > box[3]) box[3] = lat;
    }
    bounds.set(graph, box);
  }
  return box;
}

/** Fraction of sampled route points inside the extract's bounding box (cheap, conservative guard against partial coverage). */
export function routeCoverage(graph: RoadGraph, route: LngLat[]): number {
  if (route.length === 0 || graph.nodes.size === 0) return 0;
  const [minLng, minLat, maxLng, maxLat] = graphBounds(graph);
  const margin = 0.002;
  const samples = Math.min(60, route.length);
  let inside = 0;
  for (let i = 0; i < samples; i++) {
    const [lng, lat] = route[Math.round((i * (route.length - 1)) / Math.max(1, samples - 1))]!;
    if (lng >= minLng - margin && lng <= maxLng + margin && lat >= minLat - margin && lat <= maxLat + margin) inside++;
  }
  return inside / samples;
}

export function prepareGraphTrip(graph: RoadGraph, source: LngLat, destination: LngLat, displayRoute: LngLat[]): GraphTrip {
  const coverage = routeCoverage(graph, displayRoute);
  if (coverage < MIN_ROUTE_COVERAGE) {
    throw new AppError("OUT_OF_COVERAGE", `The loaded road data covers only ${Math.round(coverage * 100)}% of this route.`, { diagnostic: "route-outside-extract" });
  }
  const start = snapToRoad(graph, source, ENDPOINT_SNAP_M, drivableForStops);
  const end = start && snapToRoad(start.graph, destination, ENDPOINT_SNAP_M, drivableForStops);
  if (!start || !end) {
    throw new AppError("NO_ROUTE", "Your start or destination isn't near a drivable road in the loaded OpenStreetMap data.", { diagnostic: "endpoint-no-road" });
  }
  const working = end.graph;
  const base = shortestPath(working, start.node, end.node);
  if (!base || base.nodes.length < 2) {
    throw new AppError("NO_ROUTE", "No route between your start and destination exists in the loaded OpenStreetMap data.", { diagnostic: "no-baseline-path" });
  }
  const line = (nodes: number[], g: RoadGraph) => nodes.map((id) => g.nodes.get(id)!);
  const baselineGeometry = line(base.nodes, working);
  const baselineTurns = countUTurns(base.edges, working);

  return {
    nodes: graph.nodes.size,
    baseline: { sec: base.seconds, m: base.distanceM, geometry: baselineGeometry, uTurns: baselineTurns },
    snapM: { source: Math.round(start.distanceM), destination: Math.round(end.distanceM) },
    warnings: [...graph.warnings, "Road times are estimates from road type; they are scaled to the Google route's duration."],
    evaluate(stop) {
      const snap = snapToRoad(working, stop, STOP_SNAP_M, drivableForStops);
      if (!snap) return { ok: false, reason: "no-road" };
      const via = shortestPath(snap.graph, start.node, end.node, snap.node);
      if (!via) return { ok: false, reason: "no-path" };

      let toStopSec = 0, toStopM = 0;
      if (snap.node !== start.node) {
        for (const edge of via.edges) { toStopSec += edge.seconds; toStopM += edge.distanceM; if (edge.to === snap.node) break; }
      }
      const geometry = line(via.nodes, snap.graph);
      const stopOnRoad = snap.graph.nodes.get(snap.node)!;
      const viaTurns = countUTurns(via.edges, snap.graph, snap.node);
      const viaRoute: ViaRoute = { durationSec: via.seconds, distanceM: via.distanceM, toStopSec, geometry, snapDistanceM: Math.round(snap.distanceM), stopOnRoad, toStopDistanceM: toStopM, legs: [] };
      const assessment: RouteAssessment = {
        ...routeSide(stop, baselineGeometry),
        uTurns: { status: viaTurns > 0 ? "reported" : "none-reported", count: viaTurns, additionalToBaseline: viaTurns > baselineTurns ? "possible" : "none-detected" },
        backwardTravelNearStop: assessBackwardTravel(baselineGeometry, viaRoute),
        routeDivergence: assessDivergence(baselineGeometry, geometry),
      };
      return {
        ok: true,
        stop: {
          extraSec: Math.max(0, via.seconds - base.seconds), extraM: via.distanceM - base.distanceM,
          viaSec: via.seconds, viaM: via.distanceM, toStopSec, toStopM, geometry, stopOnRoad,
          snapDistanceM: Math.round(snap.distanceM), ambiguousSnap: snap.ambiguous, uTurns: viaTurns, assessment,
        },
      };
    },
  };
}
