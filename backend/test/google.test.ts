import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthService } from "../src/auth/service.js";
import { loadConfig } from "../src/config.js";
import type { UserPreferences } from "../src/contract/api.js";
import type { PreferencesStore } from "../src/db/preferences.js";
import { defaultUserPreferences } from "../src/domain/preferences.js";
import { AppError } from "../src/errors.js";
import { SharedRun } from "../src/lib/cache.js";
import { haversineM } from "../src/lib/geo.js";
import { QuotaManager, secondsUntilIstMonth } from "../src/lib/quota.js";
import { GOOGLE_DETAILS_FIELDS, GOOGLE_NEARBY_FIELDS, googleDetails, googleNearby, googlePhotoUri, toGoogleVenue } from "../src/providers/google.js";
import type { ProviderContext } from "../src/providers/context.js";
import { discoverGoogleVenues } from "../src/services/googleDiscovery.js";
import { evaluateHours } from "../src/services/hours.js";
import { recommend } from "../src/services/recommend.js";
import { PreferencesService } from "../src/services/preferences.js";
import { eastOf, GENEROUS_LIMITS, makeContext, north, type FakePlace } from "./fakes.js";

const source: [number, number] = [72.84, 19.2];
const destination = eastOf(source, 6000);
const mid = eastOf(source, 3000);
const fetchedAt = new Date("2026-10-30T09:00:00+05:30");
const openAllDay = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] };
interface Fixture {
  id: string; displayName: { text: string }; location: { latitude: number; longitude: number };
  [key: string]: unknown;
}
function fixture(id = "test1", point = mid, extras: Record<string, unknown> = {}): Fixture {
  return { id, displayName: { text: `Test restaurant ${id}` }, location: { latitude: point[1], longitude: point[0] },
    formattedAddress: "Test Road, Mumbai", businessStatus: "OPERATIONAL", primaryType: "restaurant", types: ["restaurant", "indian_restaurant"],
    googleMapsUri: `https://maps.google.com/?cid=${id}`, regularOpeningHours: openAllDay,
    rating: 4.3, userRatingCount: 321, servesVegetarianFood: true, servesLunch: true,
    photos: [{ name: `places/${id}/photos/photo1`, widthPx: 800, heightPx: 600, authorAttributions: [{ displayName: "Test Author", uri: "https://example.com/author" }] }],
    ...extras,
  };
}

function harness(items: Fixture[] = [fixture()], opts: { detailsCap?: number; nearbyDay?: number; nearbyMonth?: number; failure?: (url: URL) => number | undefined; penalty?: number } = {}) {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const world = { places: items.map((p) => ({ id: p.id, name: p.displayName.text, at: [p.location.longitude, p.location.latitude], provider: "mapbox", accessPenaltySec: opts.penalty ?? 0 } as FakePlace)), requests: [] as URL[] };
  const ctx = makeContext(world, { google_places_nearby: opts.nearbyDay ?? 100 });
  const routingFetch = ctx.fetchImpl;
  Object.assign(ctx, {
    restaurantSource: "google", googlePlacesEnabled: true, googlePlacesKey: "fake-google-key",
    googlePlacesLimits: { searches: 3, details: opts.detailsCap ?? 3, corridorM: 200 },
    googleMonthlyQuota: new QuotaManager({ ...GENEROUS_LIMITS, google_places_nearby: opts.nearbyMonth ?? 100 }, null, () => fetchedAt, "month"),
    googleInFlight: new SharedRun<unknown>(),
  });
  ctx.fetchImpl = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "places.googleapis.com") return routingFetch(input, init);
    requests.push({ url, init });
    const failure = opts.failure?.(url);
    if (failure) return Response.json({ error: { message: "private detail fake-google-key", status: "ERROR" } }, { status: failure });
    if (url.pathname === "/v1/places:searchNearby") {
      const body = JSON.parse(String(init?.body));
      const center: [number, number] = [body.locationRestriction.circle.center.longitude, body.locationRestriction.circle.center.latitude];
      const fields = new Headers(init?.headers).get("X-Goog-FieldMask")!.split(",").map((s) => s.replace(/^places\./, ""));
      const places = items.filter((p) => haversineM(center, [p.location.longitude, p.location.latitude]) <= body.locationRestriction.circle.radius)
        .slice(0, 20).map((p) => Object.fromEntries(Object.entries(p).filter(([key]) => fields.includes(key))));
      return Response.json({ places });
    }
    if (url.pathname === "/v1/places:searchText") {
      const body = JSON.parse(String(init?.body));
      if (!body.searchAlongRouteParameters?.polyline?.encodedPolyline) {
        return Response.json({ error: { message: "missing polyline" } }, { status: 400 });
      }
      const fields = new Headers(init?.headers).get("X-Goog-FieldMask")!.split(",").map((s) => s.replace(/^places\./, ""));
      const pageSize: number = body.pageSize ?? 20;
      const offset = body.pageToken ? Number(String(body.pageToken).replace("offset:", "")) : 0;
      const page = items.slice(offset, offset + pageSize);
      const places = page.map((p) => Object.fromEntries(Object.entries(p).filter(([key]) => fields.includes(key))));
      const nextPageToken = offset + pageSize < items.length ? `offset:${offset + pageSize}` : undefined;
      return Response.json({ places, ...(nextPageToken ? { nextPageToken } : {}) });
    }
    const id = url.pathname.slice("/v1/places/".length);
    const p = items.find((item) => item.id === id);
    return p ? Response.json(p) : Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;
  return { ctx, requests, world };
}

describe("Google Places data normalization", () => {
  it("keeps ratings, meal data, photos, attribution and address without inventing menus", () => {
    const venue = toGoogleVenue(fixture(), fetchedAt, true)!;
    expect(venue).toMatchObject({ provider: "google", vegetarian: "options", address: "Test Road, Mumbai" });
    expect(venue.google).toMatchObject({ rating: 4.3, userRatingCount: 321, meals: { lunch: true }, detailsStatus: "available" });
    expect(venue.google!.photos[0]!.authorAttributions[0]!.displayName).toBe("Test Author");
    expect(venue).not.toHaveProperty("menu");
  });
  it("preserves missing/false/true distinctions and never promotes a Google flag to pure veg", () => {
    const raw = fixture(); delete raw.servesVegetarianFood; delete raw.servesLunch;
    expect(toGoogleVenue(raw)!.vegetarian).toBe("unknown");
    expect(toGoogleVenue(raw)!.google!.meals.lunch).toBeNull();
    expect(toGoogleVenue(fixture("n", mid, { servesVegetarianFood: false }))!.vegetarian).toBe("none");
    expect(toGoogleVenue(fixture("y", mid, { types: ["vegetarian_restaurant"] }))!.vegetarian).toBe("options");
    expect(toGoogleVenue({ ...raw, types: ["vegetarian_restaurant"], displayName: { text: "Pure Veg Cafe" } })!.vegetarian).toBe("unknown");
  });
  it("rejects invalid coordinates or missing identity and sanitizes website links", () => {
    expect(toGoogleVenue({ ...fixture(), location: { latitude: 999, longitude: 72 } })).toBeNull();
    expect(toGoogleVenue({ ...fixture(), displayName: { text: "" } })).toBeNull();
    expect(toGoogleVenue(fixture("x", mid, { websiteUri: "javascript:alert(1)" }))!.website).toBeNull();
  });
  it("returns unknown for missing opening hours rather than using openNow", () => {
    const p = fixture(); delete p.regularOpeningHours;
    p.currentOpeningHours = { openNow: true };
    const venue = toGoogleVenue(p, fetchedAt)!;
    expect(evaluateHours(venue.hours ? [venue.hours] : [], fetchedAt).atArrival).toBe("unknown");
  });
  it("uses current special hours for the covered dates and regular hours afterward", () => {
    const venue = toGoogleVenue(fixture("h", mid, {
      regularOpeningHours: { periods: [{ open: { day: 5, hour: 9 }, close: { day: 5, hour: 17 } }] },
      currentOpeningHours: { periods: [{ open: { day: 5, hour: 12 }, close: { day: 5, hour: 13 } }] },
    }), fetchedAt)!;
    expect(evaluateHours([venue.hours!], new Date("2026-10-30T10:00:00+05:30")).atArrival).toBe("closed");
    expect(evaluateHours([venue.hours!], new Date("2026-10-30T12:30:00+05:30"))).toMatchObject({ atArrival: "open", closesWithinMinutes: 30 });
    expect(evaluateHours([venue.hours!], new Date("2026-11-06T10:00:00+05:30")).atArrival).toBe("open");
  });
  it("handles overnight service and does not substitute normal hours for malformed special hours", () => {
    const venue = toGoogleVenue(fixture("night", mid, { regularOpeningHours: { periods: [{ open: { day: 5, hour: 22 }, close: { day: 6, hour: 2 } }] } }), fetchedAt)!;
    expect(evaluateHours([venue.hours!], new Date("2026-10-31T01:00:00+05:30")).atArrival).toBe("open");
    const malformed = toGoogleVenue(fixture("bad", mid, { currentOpeningHours: { periods: [{ open: { day: 9, hour: 25 } }] } }), fetchedAt)!;
    expect(evaluateHours([malformed.hours!], fetchedAt).atArrival).toBe("unknown");
  });
});

describe("Google Places request controls", () => {
  it("keeps key presence separate from explicit live enablement", async () => {
    const c = loadConfig({ GOOGLE_PLACES_API_KEY: "test-only" });
    expect(c.capabilities.googlePlaces).toBe(false);
    expect(() => loadConfig({ GOOGLE_PLACES_ENABLED: "true" })).toThrow(/GOOGLE_PLACES_API_KEY/);
    const h = harness(); h.ctx.googlePlacesEnabled = false;
    await expect(googleNearby(h.ctx, source, 500)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(h.requests).toHaveLength(0);
  });
  it("uses POST, a header-only key and an explicit low-tier search field mask", async () => {
    const h = harness(); await googleNearby(h.ctx, mid, 500);
    const r = h.requests[0]!; const headers = new Headers(r.init?.headers);
    expect(r.init?.method).toBe("POST"); expect(r.url.search).toBe("");
    expect(headers.get("X-Goog-Api-Key")).toBe("fake-google-key");
    expect(headers.get("X-Goog-FieldMask")).toBe(GOOGLE_NEARBY_FIELDS.map((s) => `places.${s}`).join(","));
    expect(headers.get("X-Goog-FieldMask")).not.toContain("rating");
    expect(JSON.parse(String(r.init?.body)).maxResultCount).toBe(20);
  });
  it("fetches detailed food data only when requested and preserves review attribution", async () => {
    const h = harness([fixture("r", mid, { reviews: [{ rating: 5, text: { text: "Test review" }, authorAttribution: { displayName: "Reviewer", uri: "https://example.com" }, googleMapsUri: "https://maps.google.com" }] })]);
    const result = await googleDetails(h.ctx, "r", undefined, true);
    expect(new Headers(h.requests[0]!.init?.headers).get("X-Goog-FieldMask")).toBe([...GOOGLE_DETAILS_FIELDS, "reviews"].join(","));
    expect(result.google!.reviews[0]!.author!.displayName).toBe("Reviewer");
    expect(h.requests).toHaveLength(1); // Photo metadata never downloads a photo.
  });
  it("shares only simultaneous details and does not cache later Google responses", async () => {
    const h = harness(); await Promise.all([googleDetails(h.ctx, "test1"), googleDetails(h.ctx, "test1")]);
    expect(h.requests).toHaveLength(1);
    await googleDetails(h.ctx, "test1"); expect(h.requests).toHaveLength(2);
  });
  it("refuses invalid IDs and excessive radii before sending a request", async () => {
    const h = harness();
    await expect(googleDetails(h.ctx, "../../secrets")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(googleNearby(h.ctx, mid, 50001)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.requests).toHaveLength(0);
  });
  it("resolves a photo with one budgeted request and refuses bad references or foreign hosts", async () => {
    const h = harness();
    const calls: URL[] = [];
    let photoUri = "https://lh3.googleusercontent.com/places/abc=s800";
    h.ctx.fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); calls.push(url);
      return Response.json({ name: "places/test1/photos/photo1/media", photoUri });
    }) as typeof fetch;
    expect(await googlePhotoUri(h.ctx, "places/test1/photos/photo1", 5000)).toBe(photoUri);
    expect(calls[0]!.searchParams.get("maxWidthPx")).toBe("1600");
    expect(calls[0]!.searchParams.get("skipHttpRedirect")).toBe("true");
    expect(h.ctx.quota.snapshot().buckets.google_places_photos.used).toBe(1);
    await expect(googlePhotoUri(h.ctx, "places/test1/../secrets", 800)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    photoUri = "https://evil.example.com/x.jpg";
    await expect(googlePhotoUri(h.ctx, "places/test1/photos/photo1", 800)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(calls).toHaveLength(2);
  });
  it("enforces daily and monthly budgets before network traffic", async () => {
    for (const options of [{ nearbyDay: 1 }, { nearbyMonth: 1 }]) {
      const h = harness(undefined, options); await googleNearby(h.ctx, mid, 500);
      await expect(googleNearby(h.ctx, mid, 500)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
      expect(h.requests).toHaveLength(1);
      expect(h.ctx.quota.snapshot().buckets.google_places_nearby.used).toBe(1);
      expect(h.ctx.googleMonthlyQuota!.snapshot().buckets.google_places_nearby.used).toBe(1);
    }
  });
  it("never automatically retries billable failures and does not reveal the provider body", async () => {
    for (const status of [403, 429, 503]) {
      const h = harness(undefined, { failure: () => status });
      await expect(googleNearby(h.ctx, mid, 500)).rejects.toMatchObject({ message: expect.not.stringContaining("fake-google-key") });
      expect(h.requests).toHaveLength(1);
      expect(h.ctx.quota.snapshot().buckets.google_places_nearby.used).toBe(1);
    }
  });
  it("does not send a cancelled request", async () => {
    const h = harness(); const controller = new AbortController(); controller.abort();
    await expect(googleNearby(h.ctx, mid, 500, controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(h.requests).toHaveLength(0);
  });
  it("resets monthly budgets at the configured IST month boundary", () => {
    let time = new Date("2026-10-31T23:59:59+05:30");
    const q = new QuotaManager({ ...GENEROUS_LIMITS, google_places_nearby: 1 }, null, () => time, "month");
    q.reserve("google_places_nearby", 1); expect(q.remaining("google_places_nearby")).toBe(0);
    expect(secondsUntilIstMonth(time)).toBe(1);
    time = new Date("2026-11-01T00:00:00+05:30");
    expect(q.remaining("google_places_nearby")).toBe(1);
  });
  it("the test harness blocks accidental live calls independently of environment keys", async () => {
    await expect(fetch("https://places.googleapis.com/v1/places/example")).rejects.toThrow(/forbidden/);
  });
});

describe("Google route discovery and recommendations (mocked providers)", () => {
  const input = { source, destination, departure: new Date("2026-10-30T12:00:00+05:30"), preferences: { diet: "any" as const, includeUnconfirmedDiet: false, maxDetourMinutes: 10, cuisines: [] } };
  it("filters the 200m corridor precisely, deduplicates overlapping results and excludes closed businesses", async () => {
    const h = harness([fixture("inside", north(mid, 199)), fixture("outside", north(mid, 201)), fixture("closed", mid, { businessStatus: "CLOSED_TEMPORARILY" })]);
    const result = await discoverGoogleVenues(h.ctx, [source, destination], 200);
    expect(result.venues.map((v) => v.id)).toEqual(["google:inside"]);
    // One search-along-route call covers the whole route; no per-circle sampling.
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.url.pathname).toBe("/v1/places:searchText");
    const sentBody = JSON.parse(String(h.requests[0]!.init?.body));
    expect(sentBody.searchAlongRouteParameters.polyline.encodedPolyline).toEqual(expect.any(String));
    expect(sentBody.searchAlongRouteParameters.polyline.encodedPolyline.length).toBeGreaterThan(0);
  });
  it("paginates past 20 results and stops once Google reports no further page", async () => {
    const items = Array.from({ length: 35 }, (_, i) => fixture(`p${i}`, eastOf(source, 1000 + i * 100)));
    const h = harness(items);
    const result = await discoverGoogleVenues(h.ctx, [source, destination], 5000);
    expect(h.requests).toHaveLength(2);
    expect(result.diagnostics.discovered.google).toBe(35);
    expect(result.diagnostics.saturatedAfterRefinement).toBe(0);
  });
  it("stops at the configured page cap and reports more results may exist", async () => {
    const items = Array.from({ length: 65 }, (_, i) => fixture(`q${i}`, eastOf(source, 1000 + i * 80)));
    const h = harness(items); // harness sets googlePlacesLimits.searches = 3 (max pages)
    const result = await discoverGoogleVenues(h.ctx, [source, destination], 20000);
    expect(h.requests).toHaveLength(3);
    expect(result.diagnostics.discovered.google).toBe(60);
    expect(result.diagnostics.saturatedAfterRefinement).toBeGreaterThan(0);
    expect(result.diagnostics.warnings.some((w) => w.includes("more restaurants than"))).toBe(true);
  });
  it("returns rich restaurant data with actual via-route timings and Google attribution", async () => {
    const h = harness(); const result = await recommend(h.ctx, input, "google-test");
    expect(result.diagnostics.corridorHalfWidthM).toBe(200);
    expect(result.recommendations[0]).toMatchObject({ sources: [{ provider: "google", id: "test1" }], diet: { source: "google", vegetarian: "options" }, google: { rating: 4.3, meals: { lunch: true } } });
    expect(result.recommendations[0]!.viaRoute.geometry.length).toBeGreaterThan(1);
    expect(result.recommendations[0]!.facts.some((s) => s.includes("lunch service"))).toBe(true);
    expect(result.attribution).toContain("Google Maps");
    expect(h.requests.filter((r) => r.url.pathname.includes("searchText"))).toHaveLength(1);
    expect(h.requests.filter((r) => r.init?.method === "GET")).toHaveLength(1);
  });
  it("filters an explicitly unavailable meal at actual arrival but keeps unknown service", async () => {
    const h = harness([fixture("no-lunch", mid, { servesLunch: false }), fixture("unknown-lunch", eastOf(source, 3100), { servesLunch: undefined })]);
    const result = await recommend(h.ctx, { ...input, departure: new Date("2026-10-30T10:57:00+05:30") }, "arrival-meal");
    expect(result.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ id: "google:no-lunch", stage: "meal" })]));
    expect(result.recommendations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "google:unknown-lunch", mealPeriod: "lunch", mealRecommendation: expect.objectContaining({ service: "unknown" }) })]));
  });
  it("route-checks every corridor place while keeping Place Details within the per-request cap", async () => {
    const items = Array.from({ length: 7 }, (_, i) => fixture(`limit${i}`, eastOf(source, 1000 + i * 650)));
    const h = harness(items, { detailsCap: 2 }); const result = await recommend(h.ctx, input, "limited");
    expect(h.requests.filter((r) => r.init?.method === "GET")).toHaveLength(2);
    expect(result.diagnostics.inCorridor).toBe(7);
    expect(result.diagnostics.notEvaluated).toBe(0);
    expect(result.recommendations).toHaveLength(7);
    // Places beyond the cap are still listed, honestly marked as not enriched.
    const statuses = result.recommendations.map((r) => r.google?.detailsStatus);
    expect(statuses.filter((s) => s === "available")).toHaveLength(2);
    expect(statuses.filter((s) => s === "not-requested")).toHaveLength(5);
  });
  it("says when vegetarian status wasn't loaded rather than claiming the listing lacks it", async () => {
    const items = Array.from({ length: 3 }, (_, i) => fixture(`veg${i}`, eastOf(source, 1500 + i * 1500)));
    const h = harness(items, { detailsCap: 1 });
    const result = await recommend(h.ctx, { ...input, preferences: { ...input.preferences, diet: "vegetarian-options" } }, "veg");
    expect(result.recommendations).toHaveLength(1);
    const notLoaded = result.excluded.filter((e) => e.stage === "diet");
    expect(notLoaded).toHaveLength(2);
    expect(notLoaded[0]!.reason).toMatch(/wasn't loaded within this search's details limit/);
  });
  it("spends the details budget on the stops with the least extra driving, not the nearest in a straight line", async () => {
    const items = Array.from({ length: 4 }, (_, i) => fixture(`fast${i}`, north(eastOf(source, 1500 + i * 1000), 30)));
    const h = harness(items, { detailsCap: 2 });
    // The two straight-line-closest places hide a slow access road (e.g. a long U-turn).
    h.world.places[0]!.accessPenaltySec = 400;
    h.world.places[1]!.accessPenaltySec = 400;
    const result = await recommend(h.ctx, input, "fastest-first");
    const detailed = h.requests.filter((r) => r.init?.method === "GET").map((r) => r.url.pathname.split("/").pop());
    expect(detailed.sort()).toEqual(["fast2", "fast3"]);
    expect(result.recommendations[0]!.google?.detailsStatus).toBe("available");
  });
  it("applies dietary rules after details enrichment and does not accept vegetarian options as pure veg", async () => {
    const h = harness();
    const options = await recommend(h.ctx, { ...input, preferences: { ...input.preferences, diet: "vegetarian-options" } }, "options");
    expect(options.recommendations).toHaveLength(1);
    const pure = await recommend(h.ctx, { ...input, preferences: { ...input.preferences, diet: "pure-veg" } }, "pure");
    expect(pure.recommendations).toHaveLength(0); expect(pure.excluded[0]!.stage).toBe("diet");
  });
  it("reports detail failures as unknown data without inventing restaurant information", async () => {
    const h = harness(undefined, { failure: (url) => url.pathname.includes("searchText") ? undefined : 503 });
    const result = await recommend(h.ctx, input, "partial");
    expect(result.recommendations[0]).toMatchObject({ google: { rating: null, detailsStatus: "unavailable" }, diet: { vegetarian: "unknown" }, openingHours: { atArrival: "unknown" } });
    expect(result.diagnostics.warnings.some((w) => w.includes("could not be retrieved"))).toBe(true);
  });
  it("rejects too-expensive driving access despite a high rating", async () => {
    const h = harness([fixture("top", mid, { rating: 5 })], { penalty: 1200 });
    const result = await recommend(h.ctx, input, "detour");
    expect(result.recommendations).toHaveLength(0); expect(result.excluded[0]!.stage).toBe("detour");
  });
  it("a page exactly at the 20-result limit with no further page is not reported as truncated", async () => {
    const items = Array.from({ length: 20 }, (_, i) => fixture(`dense${i}`, mid)); const h = harness(items);
    const result = await discoverGoogleVenues(h.ctx, [source, destination], 200);
    expect(result.diagnostics.discovered.google).toBe(20);
    expect(result.diagnostics.saturatedAfterRefinement).toBe(0);
    expect(h.requests).toHaveLength(1);
  });
  it("returns an empty result honestly and makes no detail requests", async () => {
    const h = harness([]); const result = await recommend(h.ctx, input, "empty");
    expect(result.recommendations).toHaveLength(0); expect(h.requests.every((r) => r.init?.method === "POST")).toBe(true);
  });
  it("leaves legacy recommendation calls entirely free of Google requests even with a key", async () => {
    const h = harness(); h.ctx.restaurantSource = "legacy";
    const result = await recommend(h.ctx, input, "legacy");
    expect(h.requests).toHaveLength(0); expect(result.attribution).not.toContain("Google Maps");
  });
});

describe("Google backend HTTP endpoints", () => {
  let server: Server; let base: string; const h = harness();
  const auth = { authenticate: async (token: string | null) => {
    if (token !== "test-session") throw new AppError("UNAUTHENTICATED", "Sign in");
    return { id: "test-user" };
  } } as AuthService;
  beforeAll(async () => {
    server = createApp(loadConfig({}), h.ctx, { enabled: false, record() {} }, auth).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  it("status is local-only and unauthenticated requests never spend Google quota", async () => {
    const before = h.requests.length;
    const status = await fetch(`${base}/api/google/status`);
    expect(await status.json()).toMatchObject({ enabled: true, keyConfigured: true, requiresAuthentication: true });
    expect((await fetch(`${base}/api/google/restaurants/test1`)).status).toBe(401);
    expect(h.requests.length).toBe(before);
  });
  it("returns restaurant details only to an authenticated caller", async () => {
    const r = await fetch(`${base}/api/google/restaurants/test1`, { headers: { cookie: "waydine_session=test-session" } });
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json()).restaurant.google.rating).toBe(4.3);
  });
});

describe("Google recommendations with account preferences", () => {
  let server: Server;
  let base: string;
  let h: ReturnType<typeof harness>;
  let rows: Map<string, UserPreferences>;
  let store: PreferencesStore;
  let holdNearby: Promise<void> | undefined;
  const auth = { authenticate: async (token: string | null) => {
    if (token !== "alice-session" && token !== "bob-session") throw new AppError("UNAUTHENTICATED", "Sign in");
    return { id: token === "alice-session" ? "alice" : "bob" };
  } } as AuthService;
  const body = { source, destination, departure: { mode: "now" } };
  const post = (payload: unknown, user = "alice") => fetch(`${base}/api/google/recommend`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", cookie: `waydine_session=${user}-session` }, body: JSON.stringify(payload),
  });

  beforeEach(async () => {
    h = harness([fixture("test1", mid, { priceRange: { startPrice: { currencyCode: "INR", units: "400" }, endPrice: { currencyCode: "INR", units: "600" } } })]);
    holdNearby = undefined;
    const originalFetch = h.ctx.fetchImpl;
    h.ctx.fetchImpl = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (holdNearby && url.hostname === "places.googleapis.com" && url.pathname.includes("searchText")) await holdNearby;
      return originalFetch(input, init);
    }) as typeof fetch;
    rows = new Map([["alice", { ...defaultUserPreferences(), diet: "pure-veg", cuisines: ["pizza"], maxDetourMinutes: 5, budgetPerPersonInr: 300 }]]);
    store = {
      find: vi.fn(async (id) => rows.has(id) ? { preferences: structuredClone(rows.get(id)!), updatedAt: "2026-10-30T00:00:00Z" } : null),
      patch: vi.fn(async () => { throw new Error("recommendations must not write account preferences"); }),
      reset: vi.fn(async () => { throw new Error("recommendations must not reset account preferences"); }),
    };
    server = createApp(loadConfig({}), h.ctx, { enabled: false, record() {} }, auth, new PreferencesService(store)).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => server.close());

  it.each([
    { limit: "null", statuses: [200, 200, 200] },
    { limit: "2", statuses: [200, 200, 429] },
  ])("honors GOOGLE_RECOMMEND_PER_MINUTE=$limit with mocked providers", async ({ limit, statuses }) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createApp(loadConfig({ GOOGLE_RECOMMEND_PER_MINUTE: limit }), h.ctx, { enabled: false, record() {} }, auth, new PreferencesService(store)).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const status of statuses) {
      const response = await post(body);
      expect(response.status).toBe(status);
      if (status === 429) expect((await response.json()).error.code).toBe("RATE_LIMITED");
      else await response.json();
    }
  });

  it("uses the signed-in user's saved food and detour choices when overrides are omitted", async () => {
    const r = await post(body); const result = await r.json();
    expect(r.status).toBe(200);
    expect(result.preferenceContext).toMatchObject({ source: "saved", overriddenFields: [], budgetApplied: true,
      preferences: { diet: "pure-veg", cuisines: ["pizza"], maxDetourMinutes: 5, budgetPerPersonInr: 300 } });
    expect(result.recommendations).toHaveLength(0);
    // The saved "pizza" choice rules it out from search data alone, before any paid details call.
    expect(result.excluded[0].stage).toBe("cuisine");
    expect(store.find).toHaveBeenCalledWith("alice");
  });

  it("applies per-trip overrides, including false, empty lists, and clearing budget, without saving them", async () => {
    const r = await post({ ...body, preferences: { diet: "any", cuisines: [], maxDetourMinutes: 20, includeUnconfirmedDiet: false, budgetPerPersonInr: null } });
    const result = await r.json();
    expect(r.status).toBe(200); expect(result.recommendations).toHaveLength(1);
    expect(result.preferenceContext.preferences).toMatchObject({ diet: "any", cuisines: [], maxDetourMinutes: 20, includeUnconfirmedDiet: false, budgetPerPersonInr: null });
    expect(result.preferenceContext.overriddenFields).toEqual(expect.arrayContaining(["diet", "cuisines", "maxDetourMinutes", "includeUnconfirmedDiet", "budgetPerPersonInr"]));
    expect(result.preferenceContext.overriddenFields).toHaveLength(5);
    expect(result.diagnostics.warnings).not.toContain("Your food budget is not yet applied to restaurant filtering.");
    expect(rows.get("alice")).toMatchObject({ diet: "pure-veg", cuisines: ["pizza"], maxDetourMinutes: 5, budgetPerPersonInr: 300 });
    expect(store.patch).not.toHaveBeenCalled();
  });

  it("uses application defaults when the account has no saved record", async () => {
    const r = await post({ ...body, preferences: {} }, "bob"); const result = await r.json();
    expect(r.status).toBe(200); expect(result.recommendations).toHaveLength(1);
    expect(result.preferenceContext).toEqual({ preferences: defaultUserPreferences(), source: "defaults", overriddenFields: [], budgetApplied: false });
    expect(store.patch).not.toHaveBeenCalled();
  });

  it("filters by saved cuisine and lets an empty per-trip list remove that filter", async () => {
    rows.set("alice", { ...defaultUserPreferences(), cuisines: ["pizza"] });
    const filtered = await (await post(body)).json();
    expect(filtered.recommendations).toHaveLength(0);
    expect(filtered.excluded[0].stage).toBe("cuisine");
    const cleared = await (await post({ ...body, preferences: { cuisines: [] } })).json();
    expect(cleared.recommendations).toHaveLength(1);
    expect(rows.get("alice")!.cuisines).toEqual(["pizza"]);
  });

  it("enforces the saved detour limit and accepts a larger per-trip limit", async () => {
    rows.set("alice", { ...defaultUserPreferences(), maxDetourMinutes: 5 });
    h.world.places[0]!.accessPenaltySec = 400;
    const strict = await (await post(body)).json();
    expect(strict.recommendations).toHaveLength(0);
    expect(strict.excluded[0].stage).toBe("detour");
    const flexible = await (await post({ ...body, preferences: { maxDetourMinutes: 10 } })).json();
    expect(flexible.recommendations).toHaveLength(1);
    expect(rows.get("alice")!.maxDetourMinutes).toBe(5);
  });

  it("rejects invalid overrides before reading preferences or contacting providers", async () => {
    for (const preferences of [{ diet: "vegan" }, { maxDetourMinutes: 0 }, { maxDetourMinutes: null }, { cuisines: ["unsupported"] }, { budgetPerPersonInr: -1 }, { userId: "bob" }]) {
      const r = await post({ ...body, preferences }); expect(r.status).toBe(400);
    }
    expect(store.find).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0); expect(h.world.requests).toHaveLength(0);
  });

  it("does not fall back to different preferences when the account database is unavailable", async () => {
    vi.mocked(store.find).mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE", "Database unavailable"));
    const r = await post(body);
    expect(r.status).toBe(502); expect((await r.json()).error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(h.requests).toHaveLength(0); expect(h.world.requests).toHaveLength(0);
  });

  it("requires authentication before loading preferences or spending Google quota", async () => {
    const r = await fetch(`${base}/api/google/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(r.status).toBe(401); expect(store.find).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0);
  });

  it("rejects cross-origin searches before spending provider quota", async () => {
    const r = await fetch(`${base}/api/google/recommend`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example", cookie: "waydine_session=alice-session" }, body: JSON.stringify(body) });
    expect(r.status).toBe(403); expect(store.find).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0);
  });

  it("does not share filtered results across users with different budgets", async () => {
    rows.set("alice", { ...defaultUserPreferences(), budgetPerPersonInr: 300 });
    rows.set("bob", { ...defaultUserPreferences(), budgetPerPersonInr: null });
    let release!: () => void;
    holdNearby = new Promise<void>((resolve) => { release = resolve; });
    const first = post(body, "alice"); const second = post(body, "bob");
    try { await vi.waitFor(() => expect(store.find).toHaveBeenCalledTimes(2)); } finally { release(); }
    const [a, b] = await Promise.all([first.then((r) => r.json()), second.then((r) => r.json())]);
    expect(a.preferenceContext.preferences.budgetPerPersonInr).toBe(300);
    expect(b.preferenceContext.preferences.budgetPerPersonInr).toBeNull();
    expect(a.preferenceContext.budgetApplied).toBe(true);
    expect(b.preferenceContext.budgetApplied).toBe(false);
    expect(a.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "budget" })]));
    expect(b.recommendations).toHaveLength(1);
    expect(h.requests.filter((r) => r.url.pathname.includes("searchText"))).toHaveLength(2);
  });
});
