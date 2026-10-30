import type { RoadEdge, RoadGraph } from "./roadGraph.js";
import { edgeTravelTime, type TrafficSnapshot } from "./traffic.js";

interface State { node: number; previous: number | null; way: number | null; visited: boolean }
interface Item { key: string; cost: number; state: State }
export interface GraphPath { seconds: number; distanceM: number; nodes: number[]; edges: RoadEdge[]; trafficDistanceM: number; estimatedDistanceM: number }
export interface DetourResult { baseline: GraphPath; via: GraphPath; extraSeconds: number; extraDistanceM: number; warnings: string[] }
const keyOf = (s: State) => `${s.node}:${s.previous ?? "_"}:${s.way ?? "_"}:${s.visited ? 1 : 0}`;

class MinHeap {
  private items: Item[] = [];
  push(item: Item): void {
    const a = this.items; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = Math.floor((i - 1) / 2); if (a[p]!.cost <= item.cost) break; a[i] = a[p]!; i = p; } a[i] = item;
  }
  pop(): Item | undefined {
    const a = this.items; const root = a[0]; const last = a.pop();
    if (!root || !last || !a.length) return root;
    let i = 0;
    while (true) { let child = i * 2 + 1; if (child >= a.length) break; if (child + 1 < a.length && a[child + 1]!.cost < a[child]!.cost) child++; if (a[child]!.cost >= last.cost) break; a[i] = a[child]!; i = child; }
    a[i] = last; return root;
  }
}

function permitted(graph: RoadGraph, state: State, next: RoadEdge): boolean {
  if (state.way === null) return true;
  let hasOnly = false, matchesOnly = false;
  for (const rule of graph.restrictions.get(state.node) ?? []) {
    if (rule.fromWay !== state.way) continue;
    // A same-way U-turn is the reversal, not all continuation on that way.
    const reversing = state.previous === next.to;
    const matches = next.way === rule.toWay && (!rule.uturn || reversing) && (!rule.straight || !reversing);
    if (rule.kind === "no" && matches) return false;
    if (rule.kind === "only") { hasOnly = true; if (matches) matchesOnly = true; }
  }
  return !hasOnly || matchesOnly;
}

/** Dijkstra's state includes the incoming road and whether the required stop was visited. */
export function shortestPath(graph: RoadGraph, origin: number, destination: number, stop?: number, traffic?: TrafficSnapshot): GraphPath | null {
  if (!graph.nodes.has(origin) || !graph.nodes.has(destination) || (stop !== undefined && !graph.nodes.has(stop))) return null;
  const initial: State = { node: origin, previous: null, way: null, visited: stop === undefined || origin === stop };
  const initialKey = keyOf(initial); const heap = new MinHeap();
  const distances = new Map<string, number>([[initialKey, 0]]);
  const parents = new Map<string, { previous: string; edge: RoadEdge }>();
  heap.push({ key: initialKey, cost: 0, state: initial });
  let final: Item | undefined;
  while (true) {
    const current = heap.pop(); if (!current) break;
    if (current.cost !== distances.get(current.key)) continue;
    if (current.state.node === destination && current.state.visited) { final = current; break; }
    for (const edge of graph.outgoing.get(current.state.node) ?? []) {
      if (!permitted(graph, current.state, edge)) continue;
      const next: State = { node: edge.to, previous: edge.from, way: edge.way, visited: current.state.visited || edge.to === stop };
      const k = keyOf(next); const candidate = current.cost + edgeTravelTime(edge, traffic).seconds;
      if (candidate >= (distances.get(k) ?? Infinity)) continue;
      distances.set(k, candidate); parents.set(k, { previous: current.key, edge }); heap.push({ key: k, cost: candidate, state: next });
    }
  }
  if (!final) return null;
  const edges: RoadEdge[] = []; let cursor = final.key;
  while (cursor !== initialKey) { const parent = parents.get(cursor); if (!parent) throw new Error("Graph path is incomplete"); edges.push(parent.edge); cursor = parent.previous; }
  edges.reverse();
  const trafficDistanceM = edges.reduce((sum, edge) => sum + (edgeTravelTime(edge, traffic).source === "traffic" ? edge.distanceM : 0), 0);
  const distanceM = edges.reduce((sum, edge) => sum + edge.distanceM, 0);
  return { seconds: final.cost, distanceM, trafficDistanceM, estimatedDistanceM: Math.max(0, distanceM - trafficDistanceM), nodes: [origin, ...edges.map((edge) => edge.to)], edges };
}

/** Both costs use the same graph and weight model. Null means no path was found in this extract. */
export function computeDetour(graph: RoadGraph, origin: number, stop: number, destination: number, traffic?: TrafficSnapshot): DetourResult | null {
  const baseline = shortestPath(graph, origin, destination, undefined, traffic);
  const via = shortestPath(graph, origin, destination, stop, traffic);
  if (!baseline || !via) return null;
  const warnings = [...graph.warnings, "Road times are estimates; snapped access and complete turn restrictions are not guaranteed."];
  if (!traffic || baseline.estimatedDistanceM > 0 || via.estimatedDistanceM > 0) warnings.push("Live traffic is unavailable for some or all road segments; estimated speeds were used there.");
  return { baseline, via, extraSeconds: Math.max(0, via.seconds - baseline.seconds), extraDistanceM: via.distanceM - baseline.distanceM, warnings };
}
