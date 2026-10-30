import { describe, expect, it } from "vitest";
import type { LngLat } from "../src/contract/api.js";
import { haversineM } from "../src/lib/geo.js";
import type { DirectionsResult } from "../src/providers/mapbox.js";
import { assessBackwardTravel, assessDivergence, assessTurns, initialBearing, routeSide } from "../src/services/routeEvidence.js";
import { viaRouteFrom, type ViaRoute } from "../src/services/routing.js";
import { eastOf, makeContext, north, type FakeWorld } from "./fakes.js";
import { recommend } from "../src/services/recommend.js";

const start: LngLat = [72.84, 19.2];
const at = (m: number) => eastOf(start, m);
const straight = [start, at(3000), at(6000)];
const step = (type: string, modifier?: string, location?: LngLat) => ({ maneuver: { type, ...(modifier ? { modifier } : {}), ...(location ? { location } : {}) } });
const noTurn = [step("depart"), step("arrive")];
const uTurn = [step("depart"), step("turn", "uturn", at(3500)), step("arrive")];
const leg = (steps?: unknown[]) => ({ duration: 100, distance: 1000, ...(steps ? { steps } : {}) });

function via(geometry: LngLat[], stopOnRoad: LngLat, toStopDistanceM: number): ViaRoute {
  return { geometry, stopOnRoad, toStopDistanceM, snapDistanceM: 0, durationSec: 100, distanceM: 6000, toStopSec: 50, legs: [leg(noTurn), leg(noTurn)] };
}

describe("local direction and geometric side", () => {
  it("uses local travel direction and reverses left/right when travel reverses", () => {
    const northOf = north(at(2000), 50); const southOf = north(at(2000), -50);
    expect(routeSide(northOf, straight)).toEqual({ sideOfSelectedRoute: "left", localBearingDegrees: 90 });
    expect(routeSide(southOf, straight).sideOfSelectedRoute).toBe("right");
    expect(routeSide(northOf, [...straight].reverse()).sideOfSelectedRoute).toBe("right");
    expect(routeSide(southOf, [...straight].reverse()).sideOfSelectedRoute).toBe("left");
  });
  it("uses the nearby segment on a curved route instead of the overall origin/destination bearing", () => {
    const bend = at(3000); const northEnd = north(bend, 2000);
    const restaurant = eastOf(north(bend, 1000), 50);
    expect(routeSide(restaurant, [start, bend, northEnd])).toEqual({ sideOfSelectedRoute: "right", localBearingDegrees: 0 });
  });
  it("treats near-centre, degenerate, endpoints and overlapping roads conservatively", () => {
    expect(routeSide(north(at(2000), 5), straight).sideOfSelectedRoute).toBe("on-route");
    expect(routeSide(at(100), [start, start])).toEqual({ sideOfSelectedRoute: "unknown", localBearingDegrees: null });
    expect(routeSide(at(7000), straight).sideOfSelectedRoute).toBe("unknown");
    expect(routeSide(north(at(2000), 30), [start, at(6000), start]).sideOfSelectedRoute).toBe("unknown");
    expect(initialBearing(start, start)).toBeNull();
  });
});

describe("turn instructions", () => {
  it("detects a router-reported U-turn and compares it with the baseline", () => {
    expect(assessTurns([leg(noTurn)], [leg(uTurn), leg(noTurn)])).toEqual({ status: "reported", count: 1, additionalToBaseline: "possible" });
    expect(assessTurns([leg(uTurn)], [leg(uTurn), leg(noTurn)])).toEqual({ status: "reported", count: 1, additionalToBaseline: "none-detected" });
    expect(assessTurns([leg(noTurn)], [leg(noTurn), leg(noTurn)])).toEqual({ status: "none-reported", count: 0, additionalToBaseline: "none-detected" });
  });
  it("reports missing, incomplete, and unlocated maneuvers as unknown instead of assuming no U-turn", () => {
    expect(assessTurns([leg()], [leg(), leg()])).toEqual({ status: "unknown", count: null, additionalToBaseline: "unknown" });
    expect(assessTurns([leg(noTurn)], [leg([...uTurn, { invalid: true }]), leg(noTurn)])).toEqual({ status: "reported", count: null, additionalToBaseline: "unknown" });
    const missingLocation = [step("depart"), step("turn", "uturn"), step("arrive")];
    expect(assessTurns([leg(missingLocation)], [leg(missingLocation), leg(noTurn)]).additionalToBaseline).toBe("unknown");
  });
});

describe("backward travel and route deviation", () => {
  it("flags substantial backwards route progress near the stop", () => {
    const geometry = [start, at(4000), at(3000), at(6000)];
    const toStop = haversineM(start, at(4000)) + haversineM(at(4000), at(3000));
    const result = assessBackwardTravel(straight, via(geometry, at(3000), toStop));
    expect(result.status).toBe("possible");
    expect(result.estimatedMetres).toBeGreaterThanOrEqual(900);
  });
  it("does not flag a forward route, and keeps overlapping baseline geometry unknown", () => {
    const forward = via(straight, at(3000), haversineM(start, at(3000)));
    expect(assessBackwardTravel(straight, forward)).toMatchObject({ status: "not-detected", estimatedMetres: 0 });
    expect(assessBackwardTravel([start, at(6000), start], forward)).toEqual({ status: "unknown", estimatedMetres: null });
  });
  it("keeps backward travel unknown when only a small part of the route near the stop can be compared", () => {
    const stop = north(at(3000), 500);
    const geometry = [start, at(2800), stop, north(at(4500), 500), at(6000)];
    const toStop = haversineM(start, at(2800)) + haversineM(at(2800), stop);
    expect(assessBackwardTravel(straight, via(geometry, stop, toStop))).toEqual({ status: "unknown", estimatedMetres: null });
  });
  it("flags a via journey that leaves the selected route for a substantial portion", () => {
    expect(assessDivergence(straight, straight)).toEqual({ status: "not-detected", nearBaselineFraction: 1 });
    expect(assessDivergence(straight, [start, north(at(3000), 1500), at(6000)]).status).toBe("possible");
    expect(assessDivergence(straight, [start, at(100)]).status).toBe("unknown");
  });
});

describe("verified route evidence and ranking", () => {
  const request = { source: start, destination: at(6000), departure: new Date("2026-10-29T12:00:00+05:30"), preferences: { diet: "any" as const, includeUnconfirmedDiet: false, maxDetourMinutes: 15, cuisines: [] } };
  it("ranks a stop with an extra U-turn below a comparable forward stop", async () => {
    const world: FakeWorld = { requests: [], baselineSteps: noTurn, places: [
      { id: "a", name: "A Turn Cafe", provider: "mapbox", at: north(at(2000), 50), toStopSteps: uTurn, fromStopSteps: noTurn },
      { id: "b", name: "B Forward Cafe", provider: "mapbox", at: north(at(4000), 50), toStopSteps: noTurn, fromStopSteps: noTurn },
    ] };
    const result = await recommend(makeContext(world), request, "evidence");
    expect(result.recommendations.map((r) => r.name)).toEqual(["B Forward Cafe", "A Turn Cafe"]);
    const turn = result.recommendations[1]!;
    expect(turn.routeAssessment!.uTurns.additionalToBaseline).toBe("possible");
    expect(turn.uncertainties.join(" ")).toContain("U-turn not matched");
    expect(result.recommendations[0]!.routeAssessment!.uTurns.status).toBe("none-reported");
    const directions = world.requests.filter((url) => url.pathname.startsWith("/directions/v5/"));
    expect(directions).toHaveLength(3);
    expect(directions.every((url) => url.searchParams.get("steps") === "true")).toBe(true);
  });
  it("retains accessible opposite-side places and labels missing instructions unknown", async () => {
    const world: FakeWorld = { requests: [], places: [{ id: "right", name: "Right Side", provider: "mapbox", at: north(at(3000), -60) }] };
    const r = await recommend(makeContext(world), request, "side");
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]!.routeAssessment).toMatchObject({ sideOfSelectedRoute: "right", uTurns: { status: "unknown" } });
    expect(r.recommendations[0]!.uncertainties.join(" ")).toContain("crossing the road");
  });
  it("uses snapped coordinates instead of assuming zero distance when waypoint distance is missing", () => {
    const stop = at(3000); const snapped = north(stop, 100);
    const result: DirectionsResult = { code: "Ok", routes: [{ duration: 500, distance: 6000, geometry: { coordinates: straight }, legs: [leg(noTurn), leg(noTurn)] }], waypoints: [{ location: start }, { location: snapped }, { location: at(6000) }] };
    expect(viaRouteFrom(result, stop).snapDistanceM).toBeGreaterThanOrEqual(99);
    expect(() => viaRouteFrom({ ...result, waypoints: [result.waypoints[0]!] }, stop)).toThrow(/incomplete/);
    expect(() => viaRouteFrom({ ...result, routes: [{ ...result.routes[0]!, legs: [leg(noTurn)] }] }, stop)).toThrow(/incomplete/);
  });
});
