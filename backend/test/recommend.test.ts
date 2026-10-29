import { describe, expect, it } from "vitest";
import type { RecommendResponse } from "../src/contract/api.js";
import { recommend, selectForScreening, type RecommendInput } from "../src/services/recommend.js";
import { eastOf, makeContext, north, SPEED_MPS, type FakePlace, type FakeWorld } from "./fakes.js";
import type { LngLat } from "../src/lib/geo.js";

const SOURCE: LngLat = [72.84, 19.2];
const DEST = eastOf(SOURCE, 6000);

function world(places: FakePlace[], extra: Partial<FakeWorld> = {}): FakeWorld {
  return { places, requests: [], ...extra };
}

function input(overrides: Partial<RecommendInput["preferences"]> = {}, departure = new Date("2026-10-29T12:00:00+05:30")): RecommendInput {
  return {
    source: SOURCE,
    destination: DEST,
    departure,
    preferences: { diet: "any", includeUnconfirmedDiet: false, maxDetourMinutes: 15, cuisines: [], ...overrides },
  };
}

const run = (w: FakeWorld, i: RecommendInput) => recommend(makeContext(w), i, "test-req");
const names = (r: RecommendResponse) => r.recommendations.map((x) => x.name);
const exclusion = (r: RecommendResponse, name: string) => r.excluded.find((e) => e.name === name);

describe("#23/#24/#25 access comes from routing, not geometric side", () => {
  it("keeps a right-side place and a place exactly on the route line", async () => {
    const r = await run(
      world([
        { id: "right", name: "Right Side Cafe", provider: "mapbox", at: north(eastOf(SOURCE, 2000), -60) },
        { id: "online", name: "On The Line", provider: "mapbox", at: eastOf(SOURCE, 3000) },
        { id: "left", name: "Left Side Dhaba", provider: "mapbox", at: north(eastOf(SOURCE, 4000), 60) },
      ]),
      input()
    );
    expect(names(r)).toEqual(expect.arrayContaining(["Right Side Cafe", "On The Line", "Left Side Dhaba"]));
  });

  it("excludes a place only when routed access really costs too much", async () => {
    const r = await run(
      world([{ id: "uturn", name: "Long U-Turn", provider: "mapbox", at: north(eastOf(SOURCE, 2000), -60), accessPenaltySec: 25 * 60 }]),
      input()
    );
    expect(r.recommendations).toHaveLength(0);
    expect(exclusion(r, "Long U-Turn")?.stage).toBe("detour");
  });

  it("flags a stop whose route ends far from the listing as uncertain access", async () => {
    const r = await run(world([{ id: "far", name: "Back Lane", provider: "mapbox", at: north(eastOf(SOURCE, 2000), 80), snapDistanceM: 140 }]), input());
    expect(r.recommendations[0]!.access.confidence).toBe("uncertain");
    expect(r.recommendations[0]!.uncertainties.join(" ")).toMatch(/140 m/);
  });

  it("routes to the provider access point when one exists", async () => {
    const at = north(eastOf(SOURCE, 2000), 90);
    const access = north(eastOf(SOURCE, 2000), 20);
    const r = await run(world([{ id: "ap", name: "Gate Restaurant", provider: "mapbox", at, accessPoint: access }]), input());
    expect(r.recommendations[0]!.routedTo).toEqual(access);
    expect(r.recommendations[0]!.access.basis).toBe("provider-access-point");
  });
});

describe("#26/#47 complete via-stop journeys", () => {
  it("returns the verified via-route geometry and timings for each stop", async () => {
    const r = await run(world([{ id: "a", name: "A", provider: "mapbox", at: north(eastOf(SOURCE, 3000), 100) }]), input());
    const rec = r.recommendations[0]!;
    expect(rec.viaRoute.geometry.length).toBeGreaterThan(2);
    expect(rec.viaRoute.durationSec).toBeGreaterThanOrEqual(r.route.durationSec);
    expect(new Date(rec.destinationArrivalTime).getTime()).toBeGreaterThan(new Date(rec.arrivalTime).getTime());
  });
});

describe("#28 detour limit is enforced on seconds, not rounded minutes", () => {
  it("rejects a 15m29s extra journey under a 15 minute limit", async () => {
    const r = await run(
      world([{ id: "x", name: "Just Over", provider: "mapbox", at: eastOf(SOURCE, 3000), accessPenaltySec: 15 * 60 + 29 }]),
      input()
    );
    expect(r.recommendations).toHaveLength(0);
    expect(exclusion(r, "Just Over")?.stage).toBe("detour");
  });

  it("accepts a stop just under the limit", async () => {
    const r = await run(world([{ id: "y", name: "Just Under", provider: "mapbox", at: eastOf(SOURCE, 3000), accessPenaltySec: 14 * 60 + 50 }]), input());
    expect(names(r)).toEqual(["Just Under"]);
    expect(r.recommendations[0]!.extraTimeSec).toBeLessThanOrEqual(15 * 60);
  });
});

describe("#29 matrix requests are rectangular", () => {
  it("bills about 2N+1 elements instead of (N+2)^2", async () => {
    const w = world(
      Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Place ${i}`, provider: "mapbox" as const, at: north(eastOf(SOURCE, 500 + i * 500), 50) }))
    );
    const ctx = makeContext(w);
    await recommend(ctx, input(), "t");
    const elements = w.requests
      .filter((u) => u.pathname.startsWith("/directions-matrix/"))
      .reduce((sum, u) => sum + u.searchParams.get("sources")!.split(";").length * u.searchParams.get("destinations")!.split(";").length, 0);
    expect(elements).toBe(2 * 10 + 1);
    expect(ctx.quota.snapshot().buckets.mapbox_matrix_elements.used).toBe(21);
  });
});

describe("#31 unreachable places get an explicit reason, never an invalid ETA", () => {
  it("excludes an unreachable place as unreachable", async () => {
    const r = await run(world([{ id: "u", name: "Island Cafe", provider: "mapbox", at: north(eastOf(SOURCE, 2000), 50), unreachable: true }]), input());
    expect(exclusion(r, "Island Cafe")?.stage).toBe("unreachable");
    expect(JSON.stringify(r)).not.toMatch(/Invalid Date|Infinity|NaN/);
  });
});

describe("#33/#34 arrival keeps full timestamps", () => {
  it("checks the same-day hours for a 10-second stop in the departure minute", async () => {
    const departure = new Date("2026-10-29T12:00:30+05:30"); // Thursday
    const stop = eastOf(SOURCE, 100); // 10 s at 10 m/s
    const r = await run(
      world([{ id: "s", name: "Corner", provider: "mapbox", at: stop, periods: [{ open: { day: 4, time: "1100" }, close: { day: 4, time: "1300" } }] }]),
      input({}, departure)
    );
    const rec = r.recommendations[0]!;
    expect(rec.openingHours.atArrival).toBe("open");
    const elapsedMs = new Date(rec.arrivalTime).getTime() - departure.getTime();
    // ~10 s (the test point is 99.9 m away by haversine): seconds survive, no minute truncation.
    expect(Math.abs(elapsedMs - (100 / SPEED_MPS) * 1000)).toBeLessThan(100);
    expect(rec.arrivalTime).toMatch(/^2026-10-29T/);
  });
});

describe("#36/#37 vegetarian evidence", () => {
  const places: FakePlace[] = [
    { id: "pv", name: "Shuddh Bhojanalay", provider: "geoapify", at: north(eastOf(SOURCE, 1000), 40), vegetarian: "only" },
    { id: "op", name: "Mixed Kitchen", provider: "geoapify", at: north(eastOf(SOURCE, 2000), 40), vegetarian: "yes" },
    { id: "nv", name: "Pure Veg Name Only", provider: "geoapify", at: north(eastOf(SOURCE, 3000), 40) },
    { id: "no", name: "Grill House", provider: "geoapify", at: north(eastOf(SOURCE, 4000), 40), vegetarian: "no" },
  ];

  it("vegetarian-options keeps confirmed places and excludes unknown ones, even with 'Pure Veg' in the name", async () => {
    const r = await run(world(places), input({ diet: "vegetarian-options" }));
    expect(names(r).sort()).toEqual(["Mixed Kitchen", "Shuddh Bhojanalay"]);
    expect(exclusion(r, "Pure Veg Name Only")?.stage).toBe("diet");
    expect(exclusion(r, "Grill House")?.stage).toBe("diet");
  });

  it("pure-veg requires vegetarian-only evidence", async () => {
    const r = await run(world(places), input({ diet: "pure-veg" }));
    expect(names(r)).toEqual(["Shuddh Bhojanalay"]);
  });

  it("opt-in includes unconfirmed places, labelled as unconfirmed and ranked after confirmed ones", async () => {
    const r = await run(world(places), input({ diet: "vegetarian-options", includeUnconfirmedDiet: true }));
    const unconfirmed = r.recommendations.find((x) => x.name === "Pure Veg Name Only")!;
    expect(unconfirmed.diet.vegetarian).toBe("unknown");
    expect(unconfirmed.uncertainties.join(" ")).toMatch(/unconfirmed/);
    expect(names(r)).not.toContain("Grill House");
  });
});

describe("#42 no fabricated percentage score", () => {
  it("exposes facts and uncertainties, not a score", async () => {
    const r = await run(world([{ id: "a", name: "A", provider: "mapbox", at: eastOf(SOURCE, 2000) }]), input());
    const rec = r.recommendations[0]! as unknown as Record<string, unknown>;
    expect(rec.score).toBeUndefined();
    expect(Array.isArray(rec.facts)).toBe(true);
    expect((rec.uncertainties as string[]).join(" ")).toMatch(/Opening hours are not listed/);
  });
});

describe("#38/#43 hours and meal wording", () => {
  it("excludes a place closed at the verified arrival time with a dated reason", async () => {
    const r = await run(
      world([{ id: "c", name: "Breakfast Only", provider: "mapbox", at: eastOf(SOURCE, 3000), periods: [{ open: { day: 4, time: "0700" }, close: { day: 4, time: "1000" } }] }]),
      input()
    );
    expect(exclusion(r, "Breakfast Only")?.stage).toBe("hours");
    expect(exclusion(r, "Breakfast Only")?.reason).toMatch(/IST/);
  });

  it("describes meal timing as time of day, not menu availability", async () => {
    const r = await run(world([{ id: "a", name: "A", provider: "mapbox", at: eastOf(SOURCE, 2000) }]), input());
    expect(r.recommendations[0]!.facts.join(" ")).toMatch(/not a menu guarantee/);
  });
});

describe("#20 partial provider failure", () => {
  it("returns results from the working source and warns about the failed one", async () => {
    const w = world(
      [
        { id: "g", name: "OSM Place", provider: "geoapify", at: eastOf(SOURCE, 2000) },
        { id: "m", name: "Mapbox Place", provider: "mapbox", at: eastOf(SOURCE, 3000) },
      ],
      { failWhen: (u) => u.pathname.startsWith("/search/searchbox/") }
    );
    const r = await run(w, input());
    expect(names(r)).toEqual(["OSM Place"]);
    expect(r.diagnostics.providers.mapbox).toBe("error");
    expect(r.diagnostics.warnings.join(" ")).toMatch(/incomplete/);
  });

  it("fails clearly when every discovery source fails", async () => {
    const w = world([], { failWhen: (u) => u.pathname.includes("/places") || u.pathname.startsWith("/search/searchbox/") });
    await expect(run(w, input())).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});

describe("#19 cross-provider de-duplication", () => {
  it("merges the same venue from both providers and keeps both sources' evidence", async () => {
    const at = north(eastOf(SOURCE, 2500), 30);
    const r = await run(
      world([
        { id: "m1", name: "Annapurna Hotel", provider: "mapbox", at, periods: [{ open: { day: 0, time: "0000" } }], phone: "+91 22 1234 5678" },
        { id: "g1", name: "Annapurna", provider: "geoapify", at: north(at, 20), vegetarian: "only" },
      ]),
      input({ diet: "pure-veg" })
    );
    expect(r.recommendations).toHaveLength(1);
    const rec = r.recommendations[0]!;
    expect(rec.sources.map((s) => s.provider).sort()).toEqual(["geoapify", "mapbox"]);
    expect(rec.diet.vegetarian).toBe("pure-veg");
    expect(rec.openingHours.atArrival).toBe("open");
    expect(rec.phone).toBe("+91 22 1234 5678");
  });
});

describe("#18 screening slots are spread along the route", () => {
  it("does not let one dense stretch take every slot", () => {
    const dense = Array.from({ length: 60 }, (_, i) => ({ routePositionM: 100 + i, straightLineFromRouteM: i }));
    const sparse = [{ routePositionM: 9000, straightLineFromRouteM: 900 }];
    const picked = selectForScreening([...dense, ...sparse], 10_000, 10);
    expect(picked).toHaveLength(10);
    expect(picked).toContainEqual(sparse[0]);
  });

  it("reports places it could not evaluate", async () => {
    const places = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, provider: "mapbox" as const, at: north(eastOf(SOURCE, 100 * i), 20 + (i % 7)) }));
    const r = await run(world(places), input());
    expect(r.diagnostics.notEvaluated).toBeGreaterThan(0);
    expect(r.diagnostics.warnings.join(" ")).toMatch(/weren't checked in detail/);
  });
});

describe("#27 explicit baseline route selection", () => {
  it("returns the alternatives and honours a chosen route index", async () => {
    const r = await recommend(makeContext(world([])), { ...input(), routeIndex: 1 }, "t");
    expect(r.route.alternatives.length).toBe(2);
    expect(r.route.index).toBe(1);
  });
});
