import { afterEach, expect, it, vi } from "vitest";
import { fetchRecommendations } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("sends an authenticated Google recommendation request and preserves Google details", async () => {
  const google = { placeId: "p1", googleMapsUri: null, shortAddress: null, businessStatus: "OPERATIONAL", rating: 4.5, userRatingCount: 20, priceLevel: null, priceRange: null, servesVegetarianFood: null,
    meals: { breakfast: null, lunch: null, dinner: null, brunch: null, coffee: null, dessert: null }, service: { dineIn: null, takeout: null },
    amenities: { restroom: null, goodForChildren: null, menuForChildren: null, parking: null, accessibility: null, payment: null }, photos: [], reviews: [], attributions: [], detailsStatus: "available" };
  const result = { requestId: "test", timeZone: "Asia/Kolkata", route: { index: 0, geometry: [[72, 19], [73, 19]], durationSec: 1000, distanceM: 10000, summary: "", departureTime: "2026-01-01T00:00:00Z", arrivalTime: "2026-01-01T00:16:40Z", alternatives: [] },
    recommendations: [{ id: "google:p1", rank: 1, name: "Stop", venueType: null, cuisines: [], location: [72, 19], routedTo: [72, 19], address: null, phone: null, website: null, sources: [{ provider: "google", id: "p1" }], arrivalTime: "2026-01-01T00:05:00Z", extraTimeSec: 60, extraDistanceM: 100, destinationArrivalTime: "2026-01-01T00:17:40Z", straightLineFromRouteM: 10, routePositionM: 1000, access: { basis: "listing-coordinate", snapDistanceM: 10, confidence: "good" }, openingHours: { atArrival: "unknown", closesWithinMinutes: null, source: "google", text: null }, diet: { vegetarian: "unknown", source: "google" }, mealPeriod: "breakfast", viaRoute: { geometry: [[72, 19], [73, 19]], durationSec: 1060, distanceM: 10100 }, facts: [], uncertainties: [], google }],
    excluded: [], diagnostics: { corridorHalfWidthM: 200, searchAreas: { total: 1, failed: 0, truncated: 0 }, discovered: { google: 1, geoapify: 0, mapbox: 0, merged: 1, malformedDropped: 0 }, inCorridor: 1, screened: 1, verified: 1, notEvaluated: 0, excludedByStage: {}, providers: { google: "ok" }, stageMs: {}, warnings: [] }, attribution: ["Google Maps"] };
  const mockFetch = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }));
  vi.stubGlobal("fetch", mockFetch);
  const body = { source: [72, 19] as [number, number], destination: [73, 19] as [number, number], departure: { mode: "now" as const }, preferences: { diet: "any" as const, includeUnconfirmedDiet: false, maxDetourMinutes: 10, cuisines: [] } };
  const response = await fetchRecommendations(body, new AbortController().signal);
  expect(mockFetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/google\/recommend$/), expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(response.recommendations[0]!.google?.rating).toBe(4.5);
  expect(response.diagnostics.providers.google).toBe("ok");
});
