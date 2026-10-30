import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.js";
import { buildRoadGraph, type OsmElement } from "../src/graph/roadGraph.js";
import { createTripGraphLoader } from "../src/graph/tripGraph.js";
import type { LngLat } from "../src/lib/geo.js";
import { countUTurns, prepareGraphTrip } from "../src/services/graphRouting.js";
import { recommend, type RecommendInput } from "../src/services/recommend.js";
import { eastOf, makeContext, north, type FakePlace, type FakeWorld } from "./fakes.js";

const ORIGIN: LngLat = [72.84, 19.2];
/** Metres east and north of the trip's start. */
const at = (eastM: number, northM = 0): LngLat => north(eastOf(ORIGIN, eastM), northM);
const node = (id: number, p: LngLat): OsmElement => ({ type: "node", id, lon: p[0], lat: p[1] });
const way = (id: number, nodes: number[], tags: Record<string, string> = {}): OsmElement => ({ type: "way", id, nodes, tags: { highway: "residential", ...tags } });

/** A 6 km two-way primary road with a short spur at 2 km and a long one at 4 km. */
function mainRoad(): OsmElement[] {
  const xs = Array.from({ length: 13 }, (_, i) => i * 500);
  return [
    ...xs.map((x, i) => node(i + 1, at(x))),
    way(1, xs.map((_, i) => i + 1), { highway: "primary" }),
    node(101, at(2000, 100)), way(11, [5, 101]),
    node(102, at(4000, 900)), way(12, [9, 102]),
    // A road that exists in the data but is not connected to the main road.
    node(201, at(3000, 1400)), node(202, at(3200, 1400)), way(13, [201, 202]),
  ];
}

describe("graph detour engine", () => {
  const graph = buildRoadGraph(mainRoad());
  const trip = prepareGraphTrip(graph, at(0), at(6000), [at(0), at(6000)]);

  it("computes the baseline and a stop's detour on the same graph with Dijkstra", () => {
    expect(Math.abs(trip.baseline.m - 6000)).toBeLessThan(30);
    const r = trip.evaluate(at(2000, 100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 100 m out and 100 m back on a 25 km/h street.
    expect(Math.abs(r.stop.extraM - 200)).toBeLessThan(10);
    expect(r.stop.extraSec).toBeCloseTo(200 / (25 / 3.6), 0);
    expect(r.stop.geometry).toContainEqual(at(2000, 100));
    expect(r.stop.assessment.routeDivergence.status).not.toBe("possible");
  });

  it("does not count turning around at the stop or a dead end as a U-turn", () => {
    const r = trip.evaluate(at(2000, 100));
    expect(r.ok && r.stop.uTurns).toBe(0);
    expect(r.ok && r.stop.assessment.uTurns.additionalToBaseline).toBe("none-detected");
  });

  it("ranks a nearer stop ahead of a farther one by routed seconds", () => {
    const near = trip.evaluate(at(2000, 100)), far = trip.evaluate(at(4000, 900));
    expect(near.ok && far.ok).toBe(true);
    if (near.ok && far.ok) expect(far.stop.extraSec).toBeGreaterThan(near.stop.extraSec * 5);
  });

  it("separates a stop with no road nearby from one the road graph cannot reach", () => {
    expect(trip.evaluate(at(3000, 500))).toEqual({ ok: false, reason: "no-road" });
    expect(trip.evaluate(at(3100, 1400))).toEqual({ ok: false, reason: "no-path" });
  });

  it("makes a stop on the opposite carriageway cost a full loop", () => {
    const eastbound = [1, 2, 3, 4, 5], westbound = [25, 24, 23, 22, 21];
    const g = buildRoadGraph([
      ...eastbound.map((id, i) => node(id, at(i * 1000))),
      ...westbound.map((id, i) => node(id, at((4 - i) * 1000, 30))),
      way(1, eastbound, { highway: "primary", oneway: "yes" }),
      way(2, westbound, { highway: "primary", oneway: "yes" }),
      way(3, [5, 25], { highway: "secondary" }), way(4, [21, 1], { highway: "secondary" }),
    ]);
    const t = prepareGraphTrip(g, at(0), at(4000), [at(0), at(4000)]);
    const sameSide = t.evaluate(at(2000, -10)), opposite = t.evaluate(at(2000, 40));
    expect(sameSide.ok && opposite.ok).toBe(true);
    if (sameSide.ok && opposite.ok) {
      expect(sameSide.stop.extraSec).toBeLessThan(30);
      expect(opposite.stop.extraM).toBeGreaterThan(3500);
    }
  });

  it("never snaps a stop onto a motorway carriageway", () => {
    const g = buildRoadGraph([
      node(1, at(0)), node(2, at(1000)), node(3, at(2000)), node(4, at(1000, 40)), node(5, at(1000, 80)),
      way(1, [1, 2, 3], { highway: "motorway", oneway: "yes" }), way(2, [1, 2, 3], { highway: "primary" }),
      way(3, [4, 5], { highway: "service" }), way(4, [2, 4], { highway: "service" }),
    ]);
    const t = prepareGraphTrip(g, at(0), at(2000), [at(0), at(2000)]);
    const r = t.evaluate(at(1000, 5));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stop.snapDistanceM).toBeLessThanOrEqual(10);
  });

  it("refuses to route when the extract does not cover the trip or its endpoints", () => {
    expect(() => prepareGraphTrip(graph, at(0), at(6000), [at(0), at(60_000)])).toThrowError(/covers only/);
    expect(() => prepareGraphTrip(graph, at(0, 5000), at(6000), [at(0), at(6000)])).toThrowError(/near a drivable road/);
  });

  it("counts a reversal only at a through-junction", () => {
    const g = buildRoadGraph([node(1, at(0)), node(2, at(100)), node(3, at(200)), node(4, at(200, 100)), way(1, [1, 2, 3, 4])]);
    const e = (from: number, to: number) => g.outgoing.get(from)!.find((x) => x.to === to)!;
    expect(countUTurns([e(1, 2), e(2, 3), e(3, 2), e(2, 1)], g)).toBe(1);
    expect(countUTurns([e(1, 2), e(2, 1)], g)).toBe(1); // turned back at junction 2
    expect(countUTurns([e(3, 2), e(2, 1), e(1, 2)], g)).toBe(0); // node 1 is a dead end
    expect(countUTurns([e(2, 3), e(3, 4), e(4, 3)], g)).toBe(0); // node 4 is a dead end
    expect(countUTurns([e(1, 2), e(2, 3), e(3, 2)], g, 3)).toBe(0); // turning around at the stop
  });
});

const SOURCE = ORIGIN;
const DEST = at(6000);
const world = (places: FakePlace[]): FakeWorld => ({ places, requests: [] });
const input = (): RecommendInput => ({
  source: SOURCE, destination: DEST, departure: new Date("2026-10-29T12:00:00+05:30"),
  preferences: { diet: "any", includeUnconfirmedDiet: false, maxDetourMinutes: 15, cuisines: [] },
});
const places: FakePlace[] = [
  { id: "near", name: "Spur Cafe", provider: "mapbox", at: at(2000, 100) },
  { id: "far", name: "Long Spur Dhaba", provider: "mapbox", at: at(4000, 900) },
  { id: "none", name: "Nowhere Grill", provider: "mapbox", at: at(3000, 450) },
];

describe("recommendations ranked by the graph engine", () => {
  const graph = buildRoadGraph(mainRoad());
  const withGraph = (w: FakeWorld, crossCheckTop = 0) => ({ ...makeContext(w), graph: { load: async () => graph, crossCheckTop } });

  it("ranks by Dijkstra detours, plots the graph path, and makes only the baseline Google routing call", async () => {
    const w = world(places);
    const r = await recommend(withGraph(w), input(), "t");
    expect(r.routing).toMatchObject({ engine: "graph" });
    expect(r.recommendations.map((x) => x.name)).toEqual(["Spur Cafe", "Long Spur Dhaba"]);
    const [first, second] = r.recommendations;
    expect(first!.routing).toMatchObject({ engine: "graph", uTurns: 0 });
    expect(first!.viaRoute.geometry).toContainEqual(at(2000, 100));
    expect(second!.extraTimeSec).toBeGreaterThan(first!.extraTimeSec);
    expect(r.excluded.find((e) => e.name === "Nowhere Grill")).toMatchObject({ stage: "unreachable", reason: expect.stringMatching(/OpenStreetMap/) });
    expect(w.requests.filter((u) => u.pathname.startsWith("/directions-matrix")).length).toBe(0);
    expect(w.requests.filter((u) => u.pathname.startsWith("/directions/v5/")).length).toBe(1);
  });

  it("scales graph time to the baseline duration so arrival times stay consistent", async () => {
    const r = await recommend(withGraph(world(places)), input(), "t");
    const scale = r.routing!.graph!.timeScale;
    expect(scale).toBeCloseTo(r.route.durationSec / r.routing!.graph!.baselineSec, 1);
    const rec = r.recommendations[0]!;
    expect(rec.extraTimeSec).toBeCloseTo(rec.routing!.rawExtraSec * scale, -1);
  });

  it("cross-checks only the top stops against Google Routes", async () => {
    const w = world(places);
    const r = await recommend(withGraph(w, 1), input(), "t");
    expect(r.recommendations[0]!.routing!.crossCheck).toMatchObject({ status: "agrees" });
    expect(r.recommendations[1]!.routing!.crossCheck).toBeUndefined();
    expect(w.requests.filter((u) => u.pathname.startsWith("/directions/v5/")).length).toBe(2);
  });

  it("falls back to Google routing, with the reason, when the graph is unavailable", async () => {
    const ctx = { ...makeContext(world(places)), graph: { load: async () => { throw new AppError("UPSTREAM_UNAVAILABLE", "Overpass is down."); }, crossCheckTop: 3 } };
    const r = await recommend(ctx, input(), "t");
    expect(r.routing).toEqual({ engine: "google", fallbackReason: "Overpass is down." });
    expect(r.diagnostics.warnings.join(" ")).toMatch(/Google routing was used instead/);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations[0]!.routing).toBeUndefined();
  });

  it("falls back when the extract does not cover the route", async () => {
    const small = buildRoadGraph([node(1, at(0)), node(2, at(500)), way(1, [1, 2])]);
    const ctx = { ...makeContext(world(places)), graph: { load: async () => small, crossCheckTop: 0 } };
    const r = await recommend(ctx, input(), "t");
    expect(r.routing?.engine).toBe("google");
    expect(r.routing?.fallbackReason).toMatch(/covers only/);
  });
});

describe("cached corridor graph loader", () => {
  const extract = { elements: [node(1, at(0)), node(2, at(500)), node(3, at(1000)), way(1, [1, 2, 3])] };
  const route = [at(0), at(500), at(1000)];

  it("downloads a corridor once, then serves it from memory and from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waydine-osm-"));
    const fetchImpl = vi.fn(async () => Response.json(extract));
    const load = createTripGraphLoader({ source: "overpass", cacheDir: dir, fetchImpl: fetchImpl as typeof fetch });
    const [a, b] = await Promise.all([load(route), load(route)]);
    expect(a).toBe(b);
    await load(route);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toHaveLength(1);

    const restarted = createTripGraphLoader({ source: "overpass", cacheDir: dir, fetchImpl: fetchImpl as typeof fetch });
    expect((await restarted(route)).nodes.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("queries a polyline corridor of the route and caches nothing when Overpass fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waydine-osm-"));
    const failing = vi.fn(async () => new Response("busy", { status: 503 }));
    const load = createTripGraphLoader({ source: "overpass", cacheDir: dir, fetchImpl: failing as typeof fetch });
    await expect(load(route)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const query = new URLSearchParams(String((failing.mock.calls[0]![1] as RequestInit).body)).get("data")!;
    expect(query).toContain("around:1500,");
    expect(query).toContain(`${at(0)[1].toFixed(3)},${at(0)[0].toFixed(3)},${at(1000)[1].toFixed(3)},${at(1000)[0].toFixed(3)}`);
    expect(await readdir(dir)).toHaveLength(0);
  });
});
