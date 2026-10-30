import { describe, expect, it } from "vitest";
import { buildRoadGraph, type OsmElement } from "../src/graph/roadGraph.js";
import { computeDetour, shortestPath } from "../src/graph/shortestPath.js";
import { snapToRoad } from "../src/graph/snap.js";
import { graphFromOsmJson } from "../src/graph/osmExtract.js";

const node = (id: number, lon: number, lat: number): OsmElement => ({ type: "node", id, lon, lat });
const way = (id: number, nodes: number[], tags: Record<string, string> = {}): OsmElement => ({ type: "way", id, nodes, tags: { highway: "residential", ...tags } });
const restriction = (from: number, via: number, to: number, rule: string): OsmElement => ({ type: "relation", id: 500, tags: { type: "restriction", restriction: rule }, members: [{ type: "way", role: "from", ref: from }, { type: "node", role: "via", ref: via }, { type: "way", role: "to", ref: to }] });
const points: OsmElement[] = [node(1, 72.80, 19), node(2, 72.81, 19), node(3, 72.82, 19), node(4, 72.81, 19.01)];

describe("OSM directed graph and Dijkstra", () => {
  it("validates an OSM JSON extract without making provider calls", () => {
    const g = graphFromOsmJson({ elements: [...points, way(10, [1, 2])] });
    expect(shortestPath(g, 1, 2)).not.toBeNull();
    expect(() => graphFromOsmJson({ elements: [{ type: "node", id: 1, lat: 999, lon: 1 }] })).toThrow(/Invalid/);
  });
  it("finds the cheapest directed path and computes both detour costs on the same graph", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2, 3]), way(20, [2, 4])]);
    const result = computeDetour(g, 1, 4, 3)!;
    expect(result.baseline.nodes).toEqual([1, 2, 3]);
    expect(result.via.nodes).toEqual([1, 2, 4, 2, 3]);
    expect(result.extraSeconds).toBeGreaterThan(0);
    expect(result.warnings.join(" ")).toContain("estimates");
  });
  it("honors one-way, reverse one-way, implied motorway direction and denied access", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2], { oneway: "yes" }), way(20, [2, 3], { oneway: "-1" }), way(30, [3, 4], { highway: "motorway" }), way(40, [1, 4], { access: "private" })]);
    expect(shortestPath(g, 1, 2)?.nodes).toEqual([1, 2]);
    expect(shortestPath(g, 2, 1)).toBeNull();
    expect(shortestPath(g, 2, 3)).toBeNull();
    expect(shortestPath(g, 3, 2)?.nodes).toEqual([3, 2]);
    expect(shortestPath(g, 4, 3)).toBeNull();
  });
  it("tracks incoming roads to respect a prohibited turn", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2], { oneway: "yes" }), way(20, [2, 3], { oneway: "yes" }), way(30, [2, 4, 3], { oneway: "yes" }), restriction(10, 2, 20, "no_right_turn")]);
    expect(shortestPath(g, 1, 3)?.nodes).toEqual([1, 2, 4, 3]);
  });
  it("keeps turn restrictions across a required stop", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2], { oneway: "yes" }), way(20, [2, 3], { oneway: "yes" }), restriction(10, 2, 20, "no_right_turn")]);
    expect(shortestPath(g, 1, 2)).not.toBeNull();
    expect(shortestPath(g, 2, 3)).not.toBeNull();
    expect(shortestPath(g, 1, 3, 2)).toBeNull();
  });
  it("restricts same-way U-turns without blocking forward travel", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2, 3]), restriction(10, 2, 10, "no_u_turn")]);
    expect(shortestPath(g, 1, 3)?.nodes).toEqual([1, 2, 3]);
    const deadEnd = buildRoadGraph([...points, way(10, [1, 2]), restriction(10, 2, 10, "no_u_turn")]);
    expect(shortestPath(deadEnd, 1, 1, 2)).toBeNull();
  });
  it("reports incomplete or unsupported data instead of asserting safe access", () => {
    const viaWay: OsmElement = { type: "relation", id: 600, tags: { type: "restriction", restriction: "no_left_turn" }, members: [{ type: "way", role: "from", ref: 10 }, { type: "way", role: "via", ref: 20 }, { type: "way", role: "to", ref: 30 }] };
    const g = buildRoadGraph([...points, way(10, [1, 99]), way(20, [1, 2], { "access:conditional": "no @ (Mo-Fr)" }), viaWay]);
    expect(g.warnings.join(" ")).toMatch(/missing nodes/);
    expect(g.warnings.join(" ")).toMatch(/conditional/);
    expect(g.warnings.join(" ")).toMatch(/unsupported/);
    expect(shortestPath(g, 1, 99)).toBeNull();
  });
  it("snaps to a segment without introducing reverse travel on a one-way road", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2], { oneway: "yes" })]);
    const snap = snapToRoad(g, [72.805, 19])!;
    expect(snap.node).toBeLessThan(0);
    expect(shortestPath(snap.graph, 1, snap.node)?.nodes).toEqual([1, snap.node]);
    expect(shortestPath(snap.graph, snap.node, 2)?.nodes).toEqual([snap.node, 2]);
    expect(shortestPath(snap.graph, 2, snap.node)).toBeNull();
    expect(g.nodes.has(snap.node)).toBe(false);
  });
  it("splits a two-way road in both directions and reports ambiguous or distant snaps", () => {
    const g = buildRoadGraph([...points, way(10, [1, 2]), way(20, [2, 3])]);
    const snap = snapToRoad(g, [72.805, 19])!;
    expect(shortestPath(snap.graph, 2, 1)?.nodes).toEqual([2, snap.node, 1]);
    expect(snapToRoad(g, [72.81, 19])?.ambiguous).toBe(true);
    expect(snapToRoad(g, [72.805, 19.1], 50)).toBeNull();
  });
});
