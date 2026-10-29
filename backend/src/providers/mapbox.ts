/**
 * Mapbox adapter: Geocoding v6 (temporary; never cached), Search Box category
 * search (temporary; India not in documented coverage, used as a measured
 * supplementary source), Directions and Matrix (driving profile).
 */
import { z } from "zod";
import type { LngLat, PlaceKind, PlaceSuggestion } from "../contract/api.js";
import { AppError } from "../errors.js";
import { fetchJson } from "../lib/http.js";
import { bboxCenter, type BBox } from "../lib/geo.js";
import { cuisineTagsFromMapboxCategories, venueTypeFromMapbox } from "../domain/cuisine.js";
import { cleanPhone, safeHttpUrl, type MapboxPeriod, type Venue } from "../domain/venue.js";
import type { ProviderContext } from "./context.js";

const API = "https://api.mapbox.com";
export const MAPBOX_FOOD_CATEGORIES = "restaurant,cafe,fast_food,food_court,bakery";
export const MAPBOX_CATEGORY_LIMIT = 25;
export const MATRIX_MAX_COORDINATES = 25;

const finite = z.number().finite();
const lngLat = z.tuple([finite, finite]);

function requireToken(ctx: ProviderContext): string {
  if (!ctx.mapboxToken) throw new AppError("NOT_CONFIGURED", "Routing is not configured on this server.");
  return ctx.mapboxToken;
}

/* ---------- Geocoding v6 ---------- */

const geocodeFeature = z.object({
  geometry: z.object({ coordinates: lngLat }),
  properties: z.object({
    mapbox_id: z.string(),
    feature_type: z.string(),
    name: z.string().min(1),
    place_formatted: z.string().optional(),
    full_address: z.string().optional(),
  }),
});
const featureEnvelope = z.object({ features: z.array(z.unknown()) });

const KIND_BY_FEATURE_TYPE: Record<string, PlaceKind> = {
  neighborhood: "neighbourhood",
  locality: "locality",
  place: "city",
  district: "district",
  region: "region",
  postcode: "postcode",
  street: "street",
  address: "address",
};

function stripCountry(s: string | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/,?\s*India$/i, "").trim();
  return cleaned || null;
}

export function toGeocodeSuggestion(raw: unknown): PlaceSuggestion | null {
  const parsed = geocodeFeature.safeParse(raw);
  if (!parsed.success) return null;
  const { geometry, properties: p } = parsed.data;
  const kind = KIND_BY_FEATURE_TYPE[p.feature_type];
  if (!kind) return null;
  return {
    id: `mapbox:${p.mapbox_id}`,
    name: p.name.trim(),
    secondary: stripCountry(p.place_formatted),
    kind,
    coordinates: geometry.coordinates,
    source: "mapbox",
  };
}

export async function mapboxGeocode(
  ctx: ProviderContext,
  text: string,
  near: LngLat,
  signal?: AbortSignal
): Promise<PlaceSuggestion[]> {
  const token = requireToken(ctx);
  const url = new URL(`${API}/search/geocode/v6/forward`);
  url.searchParams.set("q", text);
  url.searchParams.set("country", "in");
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("worldview", "in");
  url.searchParams.set("proximity", `${near[0]},${near[1]}`);
  url.searchParams.set("types", "neighborhood,locality,place,district,postcode,street,address");
  url.searchParams.set("access_token", token);
  const data = await fetchJson({
    url: url.toString(),
    schema: featureEnvelope,
    provider: "mapbox-geocode",
    quota: ctx.quota,
    budget: { bucket: "mapbox_geocode", units: 1 },
    signal,
    timeoutMs: 4000,
    retries: 1,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  return data.features.map(toGeocodeSuggestion).filter((s): s is PlaceSuggestion => s !== null);
}

export async function mapboxReverse(ctx: ProviderContext, point: LngLat, signal?: AbortSignal): Promise<PlaceSuggestion | null> {
  const token = requireToken(ctx);
  const url = new URL(`${API}/search/geocode/v6/reverse`);
  url.searchParams.set("longitude", String(point[0]));
  url.searchParams.set("latitude", String(point[1]));
  url.searchParams.set("language", "en");
  url.searchParams.set("worldview", "in");
  url.searchParams.set("access_token", token);
  const data = await fetchJson({
    url: url.toString(),
    schema: featureEnvelope,
    provider: "mapbox-geocode",
    quota: ctx.quota,
    budget: { bucket: "mapbox_geocode", units: 1 },
    signal,
    timeoutMs: 4000,
    retries: 1,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  const first = data.features.map(toGeocodeSuggestion).find((s): s is PlaceSuggestion => s !== null) ?? null;
  return first ? { ...first, coordinates: point } : null;
}

/* ---------- Search Box category ---------- */

const periodSchema = z.object({
  open: z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^\d{4}$/) }),
  close: z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^\d{4}$/) }).optional(),
});

const categoryFeature = z.object({
  geometry: z.object({ coordinates: lngLat }),
  properties: z.object({
    mapbox_id: z.string(),
    name: z.string().min(1),
    full_address: z.string().optional(),
    place_formatted: z.string().optional(),
    poi_category_ids: z.array(z.string()).optional(),
    metadata: z
      .object({
        phone: z.string().optional(),
        website: z.string().optional(),
        open_hours: z.object({ periods: z.array(z.unknown()) }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    coordinates: z
      .object({
        routable_points: z.array(z.object({ latitude: finite, longitude: finite }).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
  }),
});

export function toMapboxVenue(raw: unknown): Venue | null {
  const parsed = categoryFeature.safeParse(raw);
  if (!parsed.success) return null;
  const { geometry, properties: p } = parsed.data;
  const routable = p.coordinates?.routable_points?.[0];

  let hours: Venue["hours"] = null;
  const rawPeriods = p.metadata?.open_hours?.periods;
  if (rawPeriods && rawPeriods.length > 0) {
    const periods: MapboxPeriod[] = [];
    let valid = true;
    for (const rp of rawPeriods) {
      const pp = periodSchema.safeParse(rp);
      if (!pp.success) {
        valid = false;
        break;
      }
      periods.push(pp.data);
    }
    // A partially malformed schedule is not trustworthy as a whole.
    if (valid) hours = { kind: "weekly-periods", provider: "mapbox", periods };
  }

  return {
    provider: "mapbox",
    providerId: p.mapbox_id,
    sourceUrl: null,
    name: p.name.trim(),
    location: geometry.coordinates,
    accessPoint: routable ? [routable.longitude, routable.latitude] : null,
    address: stripCountry(p.full_address ?? p.place_formatted),
    phone: cleanPhone(p.metadata?.phone),
    website: safeHttpUrl(p.metadata?.website),
    venueType: venueTypeFromMapbox(p.poi_category_ids),
    cuisineTags: cuisineTagsFromMapboxCategories(p.poi_category_ids),
    hours,
    vegetarian: "unknown",
  };
}

export interface CategoryPage {
  venues: Venue[];
  malformed: number;
  saturated: boolean;
}

export async function mapboxFoodCategory(
  ctx: ProviderContext,
  bbox: BBox,
  signal?: AbortSignal
): Promise<CategoryPage> {
  const token = requireToken(ctx);
  const center = bboxCenter(bbox);
  const url = new URL(`${API}/search/searchbox/v1/category/${MAPBOX_FOOD_CATEGORIES}`);
  url.searchParams.set("proximity", `${center[0].toFixed(6)},${center[1].toFixed(6)}`);
  url.searchParams.set("bbox", bbox.map((v) => v.toFixed(6)).join(","));
  url.searchParams.set("limit", String(MAPBOX_CATEGORY_LIMIT));
  url.searchParams.set("language", "en");
  url.searchParams.set("access_token", token);

  const data = await fetchJson({
    url: url.toString(),
    schema: featureEnvelope,
    provider: "mapbox-searchbox",
    quota: ctx.quota,
    budget: { bucket: "mapbox_searchbox", units: 1 },
    signal,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  const venues: Venue[] = [];
  let malformed = 0;
  for (const f of data.features) {
    const v = toMapboxVenue(f);
    if (v) venues.push(v);
    else malformed++;
  }
  return { venues, malformed, saturated: data.features.length >= MAPBOX_CATEGORY_LIMIT };
}

/* ---------- Directions ---------- */

const directionsSchema = z.object({
  code: z.string(),
  routes: z.array(
    z.object({
      duration: finite,
      distance: finite,
      geometry: z.object({ coordinates: z.array(lngLat).min(2) }),
      legs: z.array(z.object({ duration: finite, distance: finite, summary: z.string().optional() })),
    })
  ),
  waypoints: z.array(z.object({ distance: finite.optional(), name: z.string().optional(), location: lngLat })),
});

export type DirectionsResult = z.infer<typeof directionsSchema>;

function routingStatusError(status: number, body: string): AppError | undefined {
  if (status === 422 && /NoSegment|NoRoute/i.test(body)) {
    return new AppError("NO_ROUTE", "No drivable route connects these points.", { diagnostic: body.slice(0, 120) });
  }
  return undefined;
}

export async function mapboxDirections(
  ctx: ProviderContext,
  coordinates: LngLat[],
  opts: { approaches?: Array<"unrestricted" | "curb">; alternatives?: boolean; signal?: AbortSignal }
): Promise<DirectionsResult> {
  const token = requireToken(ctx);
  const coords = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const url = new URL(`${API}/directions/v5/mapbox/driving/${coords}`);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "false");
  url.searchParams.set("alternatives", String(Boolean(opts.alternatives)));
  if (opts.approaches) url.searchParams.set("approaches", opts.approaches.join(";"));
  url.searchParams.set("access_token", token);

  const data = await fetchJson({
    url: url.toString(),
    schema: directionsSchema,
    provider: "mapbox-directions",
    quota: ctx.quota,
    budget: { bucket: "mapbox_directions", units: 1 },
    signal: opts.signal,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    mapStatus: routingStatusError,
  });
  if (data.code !== "Ok" || data.routes.length === 0) {
    throw new AppError("NO_ROUTE", "No drivable route connects these points.", { diagnostic: `code=${data.code}` });
  }
  return data;
}

/* ---------- Matrix (rectangular: billed as sources x destinations) ---------- */

const matrixSchema = z.object({
  code: z.string(),
  durations: z.array(z.array(finite.nullable())),
});

export async function mapboxMatrix(
  ctx: ProviderContext,
  coordinates: LngLat[],
  sources: number[],
  destinations: number[],
  opts: { approaches?: Array<"unrestricted" | "curb">; signal?: AbortSignal }
): Promise<Array<Array<number | null>>> {
  if (coordinates.length > MATRIX_MAX_COORDINATES) {
    throw new AppError("INTERNAL", "Too many coordinates for one matrix request.");
  }
  const token = requireToken(ctx);
  const coords = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const url = new URL(`${API}/directions-matrix/v1/mapbox/driving/${coords}`);
  url.searchParams.set("sources", sources.join(";"));
  url.searchParams.set("destinations", destinations.join(";"));
  url.searchParams.set("annotations", "duration");
  if (opts.approaches) url.searchParams.set("approaches", opts.approaches.join(";"));
  url.searchParams.set("access_token", token);

  const data = await fetchJson({
    url: url.toString(),
    schema: matrixSchema,
    provider: "mapbox-matrix",
    quota: ctx.quota,
    budget: { bucket: "mapbox_matrix_elements", units: sources.length * destinations.length },
    signal: opts.signal,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    mapStatus: routingStatusError,
  });
  if (data.code !== "Ok") {
    throw new AppError("UPSTREAM_UNAVAILABLE", "Travel-time estimates are unavailable right now.", {
      diagnostic: `matrix code=${data.code}`,
    });
  }
  if (data.durations.length !== sources.length || data.durations.some((row) => row.length !== destinations.length)) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "Travel-time estimates came back incomplete.", {
      diagnostic: "matrix shape mismatch",
    });
  }
  return data.durations;
}
