import { describe, expect, it } from "vitest";
import { cumulativeDistances, haversineM, planCorridorSearch, positionOnRoute, simplifyLine, type LngLat } from "../src/lib/geo.js";

const straight = (n: number, step = 0.001): LngLat[] => Array.from({ length: n }, (_, i) => [72 + i * step, 19] as LngLat);

describe("#16 segment-aware distance from route", () => {
  it("measures zero for a point on a segment midpoint that is >400m from both vertices", () => {
    const route: LngLat[] = [[72, 19], [72.01, 19]];
    const pos = positionOnRoute([72.005, 19], route);
    expect(pos.distanceM).toBeLessThan(1);
    expect(haversineM([72.005, 19], route[0]!)).toBeGreaterThan(400);
    expect(pos.alongM).toBeCloseTo(cumulativeDistances(route)[1]! / 2, -1);
  });

  it("measures perpendicular distance to the segment", () => {
    const route: LngLat[] = [[72, 19], [72.01, 19]];
    const pos = positionOnRoute([72.005, 19 + 200 / 111_320], route);
    expect(pos.distanceM).toBeGreaterThan(195);
    expect(pos.distanceM).toBeLessThan(205);
  });
});

function assertFullCoverage(route: LngLat[], halfWidth: number, plan: ReturnType<typeof planCorridorSearch>) {
  const maxSpacing = 2 * Math.sqrt(plan.radiusM ** 2 - halfWidth ** 2);
  expect(plan.spacingM).toBeLessThanOrEqual(maxSpacing + 1e-6);
  expect(haversineM(plan.centers[0]!, route[0]!)).toBeLessThan(1);
  expect(haversineM(plan.centers.at(-1)!, route.at(-1)!)).toBeLessThan(1);
}

describe("#12 short urban routes are covered along their whole length", () => {
  it("covers the middle of a ~10km route, not just its endpoints", () => {
    const route = straight(101);
    const plan = planCorridorSearch(route, 400, 10);
    expect(plan.centers.length).toBeGreaterThan(2);
    assertFullCoverage(route, 400, plan);
  });
});

describe("#13 long routes keep their tail within the area budget", () => {
  it("includes the destination and grows the radius instead of leaving gaps", () => {
    const route = straight(2501);
    const plan = planCorridorSearch(route, 1500, 10);
    expect(plan.centers).toHaveLength(10);
    expect(plan.radiusM).toBeGreaterThan(1500 * 1.25);
    assertFullCoverage(route, 1500, plan);
  });
});

describe("simplifyLine", () => {
  it("keeps endpoints and corners, drops collinear points", () => {
    const line: LngLat[] = [...straight(50), [72.049, 19.01]];
    const simple = simplifyLine(line);
    expect(simple[0]).toEqual(line[0]);
    expect(simple.at(-1)).toEqual(line.at(-1));
    expect(simple.length).toBeLessThan(6);
  });
});
