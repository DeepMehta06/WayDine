import type { RoadEdge } from "./roadGraph.js";

/** Direction-specific observations already matched to an OSM segment by a provider adapter. */
export type TrafficObservation = { observedAtMs: number } & ({ closed: true } | { closed: false; speedKmh: number });
export interface TrafficSnapshot {
  observations: ReadonlyMap<string, TrafficObservation>;
  /** One fixed instant is used for every candidate and its baseline. */
  asOfMs: number;
  maxAgeMs: number;
}

export function trafficEdgeKey(edge: RoadEdge): string {
  return edge.trafficKey ?? `${edge.way}:${edge.from}:${edge.to}`;
}

export function edgeTravelTime(edge: RoadEdge, traffic?: TrafficSnapshot): { seconds: number; source: "traffic" | "estimated" | "closed" } {
  if (!traffic || !Number.isFinite(traffic.asOfMs) || !Number.isFinite(traffic.maxAgeMs) || traffic.maxAgeMs < 0) return { seconds: edge.seconds, source: "estimated" };
  const observation = traffic.observations.get(trafficEdgeKey(edge));
  if (!observation || !Number.isFinite(observation.observedAtMs) || observation.observedAtMs > traffic.asOfMs || traffic.asOfMs - observation.observedAtMs > traffic.maxAgeMs) return { seconds: edge.seconds, source: "estimated" };
  if (observation.closed === true) return { seconds: Infinity, source: "closed" };
  if (observation.closed !== false || !Number.isFinite(observation.speedKmh) || observation.speedKmh <= 0 || observation.speedKmh > 200) return { seconds: edge.seconds, source: "estimated" };
  return { seconds: edge.distanceM / (observation.speedKmh / 3.6), source: "traffic" };
}
