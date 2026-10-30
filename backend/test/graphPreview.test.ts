import { describe, expect, it } from "vitest";
import { graphFromOsmJson } from "../src/graph/osmExtract.js";
import { makeGraphPreview, createGraphLoader } from "../src/graph/preview.js";

const graph = graphFromOsmJson({ elements: [
  { type: "node", id: 1, lon: 72.8, lat: 19 }, { type: "node", id: 2, lon: 72.81, lat: 19 },
  { type: "node", id: 3, lon: 72.82, lat: 19 }, { type: "node", id: 4, lon: 72.81, lat: 19.01 },
  { type: "way", id: 10, nodes: [1, 2, 3], tags: { highway: "residential" } },
  { type: "way", id: 20, nodes: [2, 4], tags: { highway: "residential" } },
] });

describe("graph route preview", () => {
  it("returns actual Dijkstra coordinates and a via-stop path", () => {
    const direct = makeGraphPreview(graph, [72.8, 19], [72.82, 19]);
    const via = makeGraphPreview(graph, [72.8, 19], [72.82, 19], [72.81, 19.01]);
    expect(direct.geometry).toEqual([[72.8, 19], [72.81, 19], [72.82, 19]]);
    expect(via.geometry).toEqual([[72.8, 19], [72.81, 19], [72.81, 19.01], [72.81, 19], [72.82, 19]]);
    expect(via.durationSec).toBeGreaterThan(direct.durationSec);
    expect(via.warnings.join(" ")).toContain("planning estimate");
  });
  it("does not invent a route when a trip point is outside the extract", () => {
    expect(() => makeGraphPreview(graph, [70, 19], [72.82, 19])).toThrow(/50 m/);
  });
  it("reports an unconfigured extract without accessing any provider", () => {
    expect(() => createGraphLoader()()).toThrow(/OSM JSON/);
  });
});
