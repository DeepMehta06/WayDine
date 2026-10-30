/**
 * Deterministic fake providers for tests. Travel time is straight-line
 * distance at a fixed speed plus configurable per-place penalties, so tests
 * can construct exact detours, unreachable places and failures.
 */
import { TtlCache, InFlight } from "../src/lib/cache.js";
import { QuotaManager, type BudgetBucket } from "../src/lib/quota.js";
import { haversineM, type LngLat } from "../src/lib/geo.js";
import type { ProviderContext } from "../src/providers/context.js";

export const SPEED_MPS = 10;

export interface FakePlace {
  id: string;
  name: string;
  at: LngLat;
  provider: "mapbox" | "geoapify";
  accessPoint?: LngLat;
  /** Mapbox-format weekly periods. */
  periods?: Array<{ open: { day: number; time: string }; close?: { day: number; time: string } }>;
  /** OSM opening_hours text (Geoapify). */
  osmHours?: string;
  vegetarian?: "yes" | "only" | "no" | "limited";
  cuisine?: string;
  categories?: string[];
  phone?: string;
  website?: string;
  /** Extra seconds added to any route via this place (e.g. a U-turn). */
  accessPenaltySec?: number;
  unreachable?: boolean;
  snapDistanceM?: number;
  toStopSteps?: unknown[];
  fromStopSteps?: unknown[];
}

export interface FakeWorld {
  places: FakePlace[];
  /** URL substrings that should fail with HTTP 503. */
  failWhen?: (url: URL) => boolean;
  requests: URL[];
  baselineSteps?: unknown[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function parseCoords(pathPart: string): LngLat[] {
  return decodeURIComponent(pathPart)
    .split(";")
    .map((p) => p.split(",").map(Number) as LngLat);
}

function placeAt(world: FakeWorld, c: LngLat): FakePlace | undefined {
  return world.places.find(
    (p) => haversineM(p.accessPoint ?? p.at, c) < 1 || haversineM(p.at, c) < 1
  );
}

function legSeconds(world: FakeWorld, a: LngLat, b: LngLat): number | null {
  const pa = placeAt(world, a);
  const pb = placeAt(world, b);
  if (pa?.unreachable || pb?.unreachable) return null;
  return haversineM(a, b) / SPEED_MPS + (pb?.accessPenaltySec ?? 0);
}

function line(a: LngLat, b: LngLat, steps = 20): LngLat[] {
  return Array.from({ length: steps + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps] as LngLat);
}

export function makeFakeFetch(world: FakeWorld): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    world.requests.push(url);
    if (world.failWhen?.(url)) return json({ message: "boom" }, 503);

    if (url.pathname.startsWith("/directions/v5/")) {
      const coords = parseCoords(url.pathname.split("/").pop()!);
      const legs: Array<{ duration: number; distance: number; summary: string; steps?: unknown[] }> = [];
      const stop = coords.length === 3 ? placeAt(world, coords[1]!) : undefined;
      for (let i = 0; i < coords.length - 1; i++) {
        const s = legSeconds(world, coords[i]!, coords[i + 1]!);
        if (s === null) return json({ code: "NoSegment", message: "Could not find a matching segment" }, 422);
        const steps = coords.length === 3 ? (i === 0 ? stop?.toStopSteps : stop?.fromStopSteps) : world.baselineSteps;
        legs.push({ duration: s, distance: haversineM(coords[i]!, coords[i + 1]!), summary: "Test Road", ...(steps ? { steps } : {}) });
      }
      const geometry = coords.slice(1).flatMap((c, i) => line(coords[i]!, c).slice(i === 0 ? 0 : 1));
      const route = {
        duration: legs.reduce((a, l) => a + l.duration, 0),
        distance: legs.reduce((a, l) => a + l.distance, 0),
        geometry: { coordinates: geometry },
        legs,
      };
      const routes = url.searchParams.get("alternatives") === "true" ? [route, { ...route, duration: route.duration * 1.2, distance: route.distance * 1.1 }] : [route];
      return json({
        code: "Ok",
        routes,
        waypoints: coords.map((c) => ({ location: c, name: "", distance: placeAt(world, c)?.snapDistanceM ?? 5 })),
      });
    }

    if (url.pathname.startsWith("/directions-matrix/v1/")) {
      const coords = parseCoords(url.pathname.split("/").pop()!);
      const sources = url.searchParams.get("sources")!.split(";").map(Number);
      const destinations = url.searchParams.get("destinations")!.split(";").map(Number);
      return json({
        code: "Ok",
        durations: sources.map((s) => destinations.map((d) => (s === d ? 0 : legSeconds(world, coords[s]!, coords[d]!)))),
      });
    }

    if (url.pathname.startsWith("/search/searchbox/v1/category/")) {
      const [minLng, minLat, maxLng, maxLat] = url.searchParams.get("bbox")!.split(",").map(Number) as [number, number, number, number];
      const limit = Number(url.searchParams.get("limit"));
      const features = world.places
        .filter((p) => p.provider === "mapbox" && p.at[0] >= minLng && p.at[0] <= maxLng && p.at[1] >= minLat && p.at[1] <= maxLat)
        .slice(0, limit)
        .map((p) => ({
          geometry: { coordinates: p.at },
          properties: {
            mapbox_id: p.id,
            name: p.name,
            full_address: `${p.name} Road, Mumbai, India`,
            poi_category_ids: p.categories ?? ["restaurant"],
            metadata: {
              ...(p.phone ? { phone: p.phone } : {}),
              ...(p.website ? { website: p.website } : {}),
              ...(p.periods ? { open_hours: { periods: p.periods } } : {}),
            },
            coordinates: p.accessPoint ? { routable_points: [{ name: "POI", longitude: p.accessPoint[0], latitude: p.accessPoint[1] }] } : {},
          },
        }));
      return json({ type: "FeatureCollection", features });
    }

    if (url.hostname === "api.geoapify.com" && url.pathname === "/v2/places") {
      const [, lngS, latS, rS] = /circle:([^,]+),([^,]+),(.+)/.exec(url.searchParams.get("filter")!)!;
      const center: LngLat = [Number(lngS), Number(latS)];
      const r = Number(rS);
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const inside = world.places
        .filter((p) => p.provider === "geoapify" && haversineM(p.at, center) <= r)
        .sort((a, b) => haversineM(a.at, center) - haversineM(b.at, center));
      const features = inside.slice(offset, offset + limit).map((p) => ({
        geometry: { coordinates: p.at },
        properties: {
          place_id: p.id,
          name: p.name,
          categories: ["catering", "catering.restaurant"],
          address_line2: "Some Road, Mumbai, India",
          datasource: {
            raw: {
              ...(p.osmHours ? { opening_hours: p.osmHours } : {}),
              ...(p.vegetarian ? { "diet:vegetarian": p.vegetarian } : {}),
              ...(p.cuisine ? { cuisine: p.cuisine } : {}),
              ...(p.phone ? { phone: p.phone } : {}),
              osm_type: "n",
              osm_id: 1000 + Number(p.id.replace(/\D/g, "") || 1),
            },
          },
        },
      }));
      return json({ type: "FeatureCollection", features });
    }

    if (url.hostname === "api.geoapify.com" && url.pathname === "/v1/geocode/autocomplete") {
      return json({
        results: [{ name: "Kandivali West", result_type: "suburb", city: "Mumbai", state: "Maharashtra", lon: 72.8399, lat: 19.2055, place_id: "kw" }],
      });
    }

    if (url.pathname === "/search/geocode/v6/forward") {
      return json({
        features: [
          {
            geometry: { coordinates: [72.8434, 19.209] },
            properties: { mapbox_id: "kw-m", feature_type: "locality", name: "Kandiwali West", place_formatted: "Mumbai, Maharashtra, India" },
          },
        ],
      });
    }

    return json({ message: `unhandled ${url.pathname}` }, 404);
  }) as typeof fetch;
}

export const GENEROUS_LIMITS: Record<BudgetBucket, number> = {
  google_places_nearby: 100_000,
  google_places_details: 100_000,
  google_places_photos: 100_000,
  google_routes: 100_000,
  google_route_matrix_elements: 100_000,
  geoapify_credits: 100_000,
  mapbox_geocode: 100_000,
  mapbox_searchbox: 100_000,
  mapbox_directions: 100_000,
  mapbox_matrix_elements: 100_000,
};

export function makeContext(world: FakeWorld, limits: Partial<Record<BudgetBucket, number>> = {}): ProviderContext {
  return {
    geoapifyKey: "test-geoapify",
    mapboxToken: "test-mapbox",
    quota: new QuotaManager({ ...GENEROUS_LIMITS, ...limits }, null),
    fetchImpl: makeFakeFetch(world),
    geoapifyCache: new TtlCache<unknown>(60_000, 100),
    inFlight: new InFlight<unknown>(),
    sleep: async () => undefined,
  };
}

/** Offsets a point perpendicular to an east-west route by metres north (+) or south (-). */
export function north([lng, lat]: LngLat, metres: number): LngLat {
  return [lng, lat + metres / 111_320];
}

export function eastOf([lng, lat]: LngLat, metres: number): LngLat {
  return [lng + metres / (111_320 * Math.cos((lat * Math.PI) / 180)), lat];
}
