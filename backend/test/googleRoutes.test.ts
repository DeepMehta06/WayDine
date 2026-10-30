import { describe, expect, it } from "vitest";
import { googleDirections, googleMatrix } from "../src/providers/googleRoutes.js";
import { makeContext } from "./fakes.js";
import { screenByMatrix } from "../src/services/routing.js";

const a: [number, number] = [72.8, 19.0];
const b: [number, number] = [72.9, 19.1];
const c: [number, number] = [73.0, 19.2];
const loc = ([longitude, latitude]: [number, number]) => ({ latLng: { latitude, longitude } });
const leg = (end: [number, number], maneuver: string) => ({ duration: "60s", distanceMeters: 1000, endLocation: loc(end), steps: [{ startLocation: loc(end), navigationInstruction: { maneuver } }] });
function context(body: unknown) {
  const ctx = makeContext({ places: [], requests: [] });
  ctx.googleRoutesKey = "server-key";
  let request: RequestInit | undefined;
  ctx.fetchImpl = (async (_url, init) => { request = init; return new Response(JSON.stringify(body), { status: 200 }); }) as typeof fetch;
  return { ctx, request: () => request! };
}

describe("Google Routes adapter", () => {
  it("requests a stop on the preferred road side and preserves route evidence", async () => {
    const { ctx, request } = context({ routes: [{ duration: "120s", distanceMeters: 2000, polyline: { geoJsonLinestring: { coordinates: [a, b, c] } }, legs: [leg(b, "UTURN_LEFT"), leg(c, "TURN_RIGHT")] }] });
    const result = await googleDirections(ctx, [a, b, c], {});
    expect(JSON.parse(request().body as string).intermediates[0].sideOfRoad).toBe(true);
    expect(result.routes[0]!.duration).toBe(120);
    expect(result.waypoints[1]!.location).toEqual(b);
    expect(result.routes[0]!.legs[0]!.steps).toEqual([{ maneuver: { type: "turn", modifier: "uturn", location: b } }]);
    expect(ctx.quota.snapshot().buckets.google_routes.used).toBe(1);
  });
  it("matches unordered matrix elements by indices and preserves unreachable routes", async () => {
    const { ctx } = context([{ destinationIndex: 1, condition: "ROUTE_NOT_FOUND" }, { condition: "ROUTE_EXISTS", duration: "12.5s" }]);
    expect(await googleMatrix(ctx, [a, b, c], [0], [1, 2], {})).toEqual([[12.5, null]]);
    expect(ctx.quota.snapshot().buckets.google_route_matrix_elements.used).toBe(2);
  });
  it("rejects an incomplete matrix rather than treating it as unreachable", async () => {
    const { ctx } = context([{ condition: "ROUTE_EXISTS", duration: "12s" }]);
    await expect(googleMatrix(ctx, [a, b, c], [0], [1, 2], {})).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
  it("screens a single stop with at least two destinations in each matrix request", async () => {
    const ctx = makeContext({ places: [], requests: [] });
    ctx.googleRoutesKey = "server-key";
    ctx.routingProvider = "google";
    ctx.fetchImpl = (async (_url, init) => {
      const payload = JSON.parse(init!.body as string);
      expect(payload.destinations).toHaveLength(2);
      return new Response(JSON.stringify([{ condition: "ROUTE_EXISTS", duration: "40s" }, { destinationIndex: 1, condition: "ROUTE_EXISTS", duration: "60s" }]));
    }) as typeof fetch;
    const result = await screenByMatrix(ctx, a, c, [b]);
    expect(result.screened[0]!.estimatedExtraSec).toBe(20);
    expect(result.elements).toBe(4);
  });
});
