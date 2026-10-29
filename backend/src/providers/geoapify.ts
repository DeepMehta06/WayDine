/**
 * Geoapify adapter (OpenStreetMap-derived, documented worldwide coverage).
 * Free plan: 3,000 credits/day; autocomplete/reverse = 1 credit, Places with
 * limit <= 20 = 1 credit. Attribution to OSM and Geoapify is mandatory.
 */
import { z } from "zod";
import type { LngLat, PlaceKind, PlaceSuggestion } from "../contract/api.js";
import { AppError } from "../errors.js";
import { fetchJson } from "../lib/http.js";
import { normalizeCuisineTags, venueTypeFromGeoapify } from "../domain/cuisine.js";
import { cleanPhone, osmObjectUrl, safeHttpUrl, vegetarianFromOsm, type Venue } from "../domain/venue.js";
import { coordKey, type ProviderContext } from "./context.js";

const BASE = "https://api.geoapify.com";
export const GEOAPIFY_FOOD_CATEGORIES = [
  "catering.restaurant",
  "catering.cafe",
  "catering.fast_food",
  "catering.food_court",
  "commercial.food_and_drink.bakery",
].join(",");
export const GEOAPIFY_PLACES_LIMIT = 20;

const finite = z.number().finite();
const resultSchema = z.object({
  name: z.string().optional(),
  result_type: z.string().optional(),
  suburb: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  place_id: z.string().optional(),
  lon: finite,
  lat: finite,
});
const geocodeEnvelope = z.object({ results: z.array(z.unknown()) });

const placeFeatureSchema = z.object({
  geometry: z.object({ coordinates: z.tuple([finite, finite]) }),
  properties: z.object({
    place_id: z.string(),
    name: z.string().min(1),
    categories: z.array(z.string()).optional(),
    address_line2: z.string().optional(),
    formatted: z.string().optional(),
    opening_hours: z.string().optional(),
    website: z.string().optional(),
    contact: z.object({ phone: z.string().optional() }).passthrough().optional(),
    datasource: z.object({ raw: z.record(z.unknown()).optional() }).passthrough().optional(),
  }),
});
const placesEnvelope = z.object({ features: z.array(z.unknown()) });

function requireKey(ctx: ProviderContext): string {
  if (!ctx.geoapifyKey) throw new AppError("NOT_CONFIGURED", "Geoapify is not configured.");
  return ctx.geoapifyKey;
}

const KIND_BY_RESULT_TYPE: Record<string, PlaceKind> = {
  suburb: "suburb",
  district: "district",
  city: "city",
  county: "region",
  state: "region",
  postcode: "postcode",
  street: "street",
  building: "address",
  amenity: "poi",
};

function stripCountry(s: string | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/,?\s*India$/i, "").trim();
  return cleaned || null;
}

export function toSuggestion(raw: unknown): PlaceSuggestion | null {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const kind = KIND_BY_RESULT_TYPE[r.result_type ?? ""] ?? "address";
  const name = (r.name ?? r.address_line1 ?? "").trim();
  if (!name) return null;
  let secondary: string | null;
  if (kind === "suburb" || kind === "district" || kind === "city" || kind === "region") {
    const parts = [r.city ?? r.county, r.state].filter((p): p is string => Boolean(p && p !== name));
    secondary = parts.length ? [...new Set(parts)].join(", ") : stripCountry(r.address_line2);
  } else {
    secondary = stripCountry(r.address_line2);
  }
  return {
    id: `geoapify:${r.place_id ?? `${r.lon},${r.lat}`}`,
    name,
    secondary,
    kind,
    coordinates: [r.lon, r.lat],
    source: "geoapify",
  };
}

export async function geoapifyAutocomplete(
  ctx: ProviderContext,
  text: string,
  near: LngLat,
  signal?: AbortSignal
): Promise<PlaceSuggestion[]> {
  const apiKey = requireKey(ctx);
  const cacheKey = `ac|${text.toLowerCase()}|${coordKey(near, 1)}`;
  const cached = ctx.geoapifyCache.get(cacheKey) as PlaceSuggestion[] | undefined;
  if (cached) return cached;

  const url = new URL(`${BASE}/v1/geocode/autocomplete`);
  url.searchParams.set("text", text);
  url.searchParams.set("filter", "countrycode:in");
  url.searchParams.set("bias", `proximity:${near[0]},${near[1]}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "7");
  url.searchParams.set("lang", "en");
  url.searchParams.set("apiKey", apiKey);

  const data = await fetchJson({
    url: url.toString(),
    schema: geocodeEnvelope,
    provider: "geoapify",
    quota: ctx.quota,
    budget: { bucket: "geoapify_credits", units: 1 },
    signal,
    timeoutMs: 4000,
    retries: 1,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  const suggestions = data.results.map(toSuggestion).filter((s): s is PlaceSuggestion => s !== null);
  ctx.geoapifyCache.set(cacheKey, suggestions);
  return suggestions;
}

export async function geoapifyReverse(ctx: ProviderContext, point: LngLat, signal?: AbortSignal): Promise<PlaceSuggestion | null> {
  const apiKey = requireKey(ctx);
  const cacheKey = `rev|${coordKey(point, 5)}`;
  const cached = ctx.geoapifyCache.get(cacheKey) as PlaceSuggestion | null | undefined;
  if (cached !== undefined) return cached;

  const url = new URL(`${BASE}/v1/geocode/reverse`);
  url.searchParams.set("lat", String(point[1]));
  url.searchParams.set("lon", String(point[0]));
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("apiKey", apiKey);
  const data = await fetchJson({
    url: url.toString(),
    schema: geocodeEnvelope,
    provider: "geoapify",
    quota: ctx.quota,
    budget: { bucket: "geoapify_credits", units: 1 },
    signal,
    timeoutMs: 4000,
    retries: 1,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
  });
  const first = data.results.map(toSuggestion).find((s): s is PlaceSuggestion => s !== null) ?? null;
  // A reverse lookup describes the pin, but the pin itself is what gets routed.
  const result = first ? { ...first, coordinates: point } : null;
  ctx.geoapifyCache.set(cacheKey, result);
  return result;
}

export function toVenue(raw: unknown): Venue | null {
  const parsed = placeFeatureSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { geometry, properties: p } = parsed.data;
  const tags = p.datasource?.raw ?? {};
  const hoursText = typeof tags.opening_hours === "string" ? tags.opening_hours : p.opening_hours;
  return {
    provider: "geoapify",
    providerId: p.place_id,
    sourceUrl: osmObjectUrl(tags.osm_type, tags.osm_id),
    name: p.name.trim(),
    location: geometry.coordinates,
    accessPoint: null,
    address: stripCountry(p.address_line2 ?? p.formatted),
    phone: cleanPhone(tags.phone ?? tags["contact:phone"] ?? p.contact?.phone),
    website: safeHttpUrl(tags.website ?? tags["contact:website"] ?? p.website),
    venueType: venueTypeFromGeoapify(p.categories),
    cuisineTags: normalizeCuisineTags(tags.cuisine),
    hours: hoursText ? { kind: "osm", provider: "geoapify", text: hoursText } : null,
    vegetarian: vegetarianFromOsm(tags["diet:vegetarian"]),
  };
}

export interface PlacesPage {
  venues: Venue[];
  malformed: number;
  /** True when the provider returned its maximum page size (results likely truncated). */
  saturated: boolean;
}

export async function geoapifyPlaces(
  ctx: ProviderContext,
  center: LngLat,
  radiusM: number,
  offset = 0,
  signal?: AbortSignal
): Promise<PlacesPage> {
  const apiKey = requireKey(ctx);
  const r = Math.round(radiusM);
  const cacheKey = `places|${coordKey(center)}|${r}|${offset}`;
  const cached = ctx.geoapifyCache.get(cacheKey) as PlacesPage | undefined;
  if (cached) return cached;

  const url = new URL(`${BASE}/v2/places`);
  url.searchParams.set("categories", GEOAPIFY_FOOD_CATEGORIES);
  url.searchParams.set("filter", `circle:${center[0]},${center[1]},${r}`);
  url.searchParams.set("bias", `proximity:${center[0]},${center[1]}`);
  url.searchParams.set("limit", String(GEOAPIFY_PLACES_LIMIT));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  url.searchParams.set("lang", "en");
  url.searchParams.set("apiKey", apiKey);

  const page = await ctx.inFlight.run(cacheKey, async () => {
    const data = await fetchJson({
      url: url.toString(),
      schema: placesEnvelope,
      provider: "geoapify",
      quota: ctx.quota,
      budget: { bucket: "geoapify_credits", units: 1 },
      signal,
      fetchImpl: ctx.fetchImpl,
      sleep: ctx.sleep,
    });
    const venues: Venue[] = [];
    let malformed = 0;
    for (const f of data.features) {
      const v = toVenue(f);
      if (v) venues.push(v);
      else malformed++;
    }
    const result: PlacesPage = { venues, malformed, saturated: data.features.length >= GEOAPIFY_PLACES_LIMIT };
    ctx.geoapifyCache.set(cacheKey, result);
    return result;
  });
  return page as PlacesPage;
}
