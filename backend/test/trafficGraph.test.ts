import { describe, expect, it } from "vitest";
import { buildRoadGraph, type OsmElement } from "../src/graph/roadGraph.js";
import { computeDetour, shortestPath } from "../src/graph/shortestPath.js";
import { snapToRoad } from "../src/graph/snap.js";
import { edgeTravelTime, type TrafficSnapshot } from "../src/graph/traffic.js";

const elements: OsmElement[] = [
  { type: "node", id: 1, lon: 72.8, lat: 19 }, { type: "node", id: 2, lon: 72.81, lat: 19 },
  { type: "node", id: 3, lon: 72.82, lat: 19 }, { type: "node", id: 4, lon: 72.81, lat: 19.005 },
  { type: "way", id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
  { type: "way", id: 20, nodes: [1, 4, 3], tags: { highway: "residential" } },
];
const snapshot = (entries: Array<[string, { observedAtMs: number; closed: false; speedKmh: number } | { observedAtMs: number; closed: true }]>, asOfMs = 1000): TrafficSnapshot => ({ observations: new Map(entries), asOfMs, maxAgeMs: 500 });

describe("traffic-weighted graph routing", () => {
  it("selects an alternative when fresh traffic slows the direct road", () => {
    const graph = buildRoadGraph(elements);
    expect(shortestPath(graph, 1, 3)?.nodes).toEqual([1, 2, 3]);
    const traffic = snapshot([["10:1:2", { observedAtMs: 900, closed: false, speedKmh: 2 }]]);
    const path = shortestPath(graph, 1, 3, undefined, traffic)!;
    expect(path.nodes).toEqual([1, 4, 3]);
    expect(path.estimatedDistanceM).toBeGreaterThan(0);
  });
  it("uses the same traffic snapshot for the baseline and the required stop", () => {
    const graph = buildRoadGraph(elements);
    const traffic = snapshot([["10:1:2", { observedAtMs: 900, closed: false, speedKmh: 10 }], ["10:2:3", { observedAtMs: 900, closed: false, speedKmh: 10 }]]);
    const result = computeDetour(graph, 1, 2, 3, traffic)!;
    expect(result.via.trafficDistanceM).toBeGreaterThan(0);
    expect(result.extraSeconds).toBeGreaterThanOrEqual(0);
    expect(result.warnings.join(" ")).toContain("estimated speeds");
  });
  it("falls back for stale, future and invalid observations and never applies them in the opposite direction", () => {
    const graph = buildRoadGraph(elements); const edge = graph.outgoing.get(1)!.find((e) => e.to === 2)!;
    for (const observation of [{ observedAtMs: 100, closed: false as const, speedKmh: 1 }, { observedAtMs: 1001, closed: false as const, speedKmh: 1 }, { observedAtMs: 900, closed: false as const, speedKmh: 0 }]) {
      expect(edgeTravelTime(edge, snapshot([["10:1:2", observation]])).source).toBe("estimated");
    }
    const reverse = graph.outgoing.get(2)!.find((e) => e.to === 1)!;
    expect(edgeTravelTime(reverse, snapshot([["10:1:2", { observedAtMs: 900, closed: false, speedKmh: 1 }]])).source).toBe("estimated");
  });
  it("avoids a confirmed fresh closure but does not treat stale closure data as current", () => {
    const graph = buildRoadGraph(elements);
    expect(shortestPath(graph, 1, 3, undefined, snapshot([["10:1:2", { observedAtMs: 900, closed: true }]]))!.nodes).toEqual([1, 4, 3]);
    expect(shortestPath(graph, 1, 3, undefined, snapshot([["10:1:2", { observedAtMs: 100, closed: true }]]))!.nodes).toEqual([1, 2, 3]);
  });
  it("preserves traffic matching and distance when splitting a road for a stop", () => {
    const graph = buildRoadGraph(elements); const snap = snapToRoad(graph, [72.805, 19])!;
    const traffic = snapshot([["10:1:2", { observedAtMs: 900, closed: false, speedKmh: 10 }]]);
    const whole = shortestPath(graph, 1, 2, undefined, traffic)!;
    const split = shortestPath(snap.graph, 1, 2, snap.node, traffic)!;
    expect(split.seconds).toBeCloseTo(whole.seconds, 6);
    expect(split.trafficDistanceM).toBeCloseTo(whole.distanceM, 6);
    expect(shortestPath(snap.graph, 2, 1, undefined, traffic)!.trafficDistanceM).toBe(0);
  });
});
