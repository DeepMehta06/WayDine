import type { LngLat } from "../contract/api.js";
import { haversineM, positionOnRoute } from "../lib/geo.js";
import type { RoadEdge, RoadGraph } from "./roadGraph.js";
import { trafficEdgeKey } from "./traffic.js";

export interface SnapResult { graph: RoadGraph; node: number; distanceM: number; ambiguous: boolean }

/** Attach a virtual point by splitting both directions of the selected road segment. */
export function snapToRoad(graph: RoadGraph, point: LngLat, maxDistanceM = 50, accept?: (edge: RoadEdge) => boolean): SnapResult | null {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(maxDistanceM) || maxDistanceM < 0) return null;
  let best: { edge: RoadEdge; distance: number; projected: LngLat; fraction: number } | undefined;
  let secondDistance = Infinity;
  const seen = new Set<string>();
  for (const edges of graph.outgoing.values()) for (const edge of edges) {
    if (accept && !accept(edge)) continue;
    const a = graph.nodes.get(edge.from), b = graph.nodes.get(edge.to); if (!a || !b) continue;
    const segment = `${edge.way}:${Math.min(edge.from, edge.to)}:${Math.max(edge.from, edge.to)}`;
    if (seen.has(segment)) continue; seen.add(segment);
    const projection = positionOnRoute(point, [a, b]);
    const fraction = edge.distanceM > 0 ? projection.alongM / edge.distanceM : 0;
    if (!best || projection.distanceM < best.distance) {
      secondDistance = best ? Math.min(secondDistance, best.distance) : secondDistance;
      best = { edge, distance: projection.distanceM, projected: projection.projected, fraction };
    } else secondDistance = Math.min(secondDistance, projection.distanceM);
  }
  if (!best || best.distance > maxDistanceM) return null;
  const ambiguous = secondDistance <= best.distance + 5;
  const distanceM = haversineM(point, best.projected);
  if (best.fraction <= 1e-7) return { graph, node: best.edge.from, distanceM, ambiguous };
  if (best.fraction >= 1 - 1e-7) return { graph, node: best.edge.to, distanceM, ambiguous };
  let id = -1; while (graph.nodes.has(id)) id--;
  const nodes = new Map(graph.nodes); nodes.set(id, best.projected);
  const outgoing = new Map<number, RoadEdge[]>();
  const add = (edge: RoadEdge) => { const list = outgoing.get(edge.from) ?? []; list.push(edge); outgoing.set(edge.from, list); };
  for (const edges of graph.outgoing.values()) for (const edge of edges) {
    const same = edge.way === best.edge.way && ((edge.from === best.edge.from && edge.to === best.edge.to) || (edge.from === best.edge.to && edge.to === best.edge.from));
    if (!same) { add(edge); continue; }
    const f = edge.from === best.edge.from ? best.fraction : 1 - best.fraction;
    const trafficKey = trafficEdgeKey(edge);
    add({ ...edge, trafficKey, to: id, distanceM: edge.distanceM * f, seconds: edge.seconds * f });
    add({ ...edge, trafficKey, from: id, distanceM: edge.distanceM * (1 - f), seconds: edge.seconds * (1 - f) });
  }
  return { graph: { ...graph, nodes, outgoing }, node: id, distanceM, ambiguous };
}
