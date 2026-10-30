/**
 * Typed API client. Responses are validated at runtime with schemas that are
 * compile-time tied to the shared backend contract, so a malformed or
 * mismatched response becomes a clear error instead of a broken render.
 */
import { z } from "zod";
import type {
  ApiErrorCode,
  AuthMeResponse,
  GoogleRecommendRequest,
  GoogleRecommendResponse,
  LngLat,
  UserPreferencesPatch,
  PlaceSuggestion,
  Recommendation,
  RecommendRequest,
  RecommendResponse,
  UserPreferencesResponse,
  ReverseResponse,
  SuggestResponse,
} from "@contract";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly code: ApiErrorCode | "NETWORK" | "MALFORMED";
  readonly retryAfterSec?: number;
  readonly fieldErrors: Record<string, string[]>;

  constructor(code: ApiError["code"], message: string, opts: { retryAfterSec?: number; fieldErrors?: Record<string, string[]> } = {}) {
    super(message);
    this.code = code;
    this.retryAfterSec = opts.retryAfterSec;
    this.fieldErrors = opts.fieldErrors ?? {};
  }

  get retryable(): boolean {
    return ["NETWORK", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "RATE_LIMITED", "INTERNAL", "MALFORMED"].includes(this.code);
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

const lngLat = z.tuple([z.number(), z.number()]) satisfies z.ZodType<LngLat>;
const provider = z.enum(["geoapify", "mapbox"]);
const restaurantProvider = z.enum(["geoapify", "mapbox", "google"]);
const providerStatus = z.enum(["ok", "error", "disabled", "skipped", "quota"]);

const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  secondary: z.string().nullable(),
  kind: z.enum(["neighbourhood", "locality", "suburb", "district", "city", "region", "postcode", "street", "address", "poi"]),
  coordinates: lngLat,
  source: provider,
}) satisfies z.ZodType<PlaceSuggestion>;

const suggestSchema = z.object({
  suggestions: z.array(placeSchema),
  providers: z.object({ geoapify: providerStatus.optional(), mapbox: providerStatus.optional() }),
  partial: z.boolean(),
}) satisfies z.ZodType<SuggestResponse>;

const reverseSchema = z.object({ place: placeSchema.nullable() }) satisfies z.ZodType<ReverseResponse>;

const recommendationSchema = z.object({
  id: z.string(),
  rank: z.number(),
  name: z.string(),
  venueType: z.string().nullable(),
  cuisines: z.array(z.string()),
  location: lngLat,
  routedTo: lngLat,
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  sources: z.array(z.object({ provider: restaurantProvider, id: z.string(), url: z.string().optional() })),
  arrivalTime: z.string(),
  extraTimeSec: z.number(),
  extraDistanceM: z.number(),
  destinationArrivalTime: z.string(),
  straightLineFromRouteM: z.number(),
  routePositionM: z.number(),
  access: z.object({
    basis: z.enum(["provider-access-point", "listing-coordinate"]),
    snapDistanceM: z.number(),
    confidence: z.enum(["good", "uncertain"]),
  }),
  openingHours: z.object({
    atArrival: z.enum(["open", "closed", "unknown"]),
    closesWithinMinutes: z.number().nullable(),
    source: restaurantProvider.nullable(),
    text: z.string().nullable(),
  }),
  diet: z.object({ vegetarian: z.enum(["pure-veg", "options", "none", "unknown"]), source: restaurantProvider.nullable() }),
  mealPeriod: z.enum(["breakfast", "lunch", "snacks", "dinner", "late night"]),
  mealRecommendation: z.object({ service: z.enum(["listed", "not-listed", "unknown"]), ideas: z.array(z.string()), disclaimer: z.string() }).optional(),
  budgetAssessment: z.object({ status: z.enum(["not-set", "likely-within", "unconfirmed"]), budgetPerPersonInr: z.number().nullable() }).optional(),
  viaRoute: z.object({ geometry: z.array(lngLat), durationSec: z.number(), distanceM: z.number() }),
  facts: z.array(z.string()),
  uncertainties: z.array(z.string()),
  google: z.object({
    placeId: z.string(), googleMapsUri: z.string().nullable(), shortAddress: z.string().nullable(), businessStatus: z.string().nullable(),
    rating: z.number().nullable(), userRatingCount: z.number().nullable(), priceLevel: z.string().nullable(),
    priceRange: z.object({ start: z.object({ currencyCode: z.string(), units: z.string(), nanos: z.number() }).nullable(), end: z.object({ currencyCode: z.string(), units: z.string(), nanos: z.number() }).nullable() }).nullable(),
    servesVegetarianFood: z.boolean().nullable(),
    meals: z.object({ breakfast: z.boolean().nullable(), lunch: z.boolean().nullable(), dinner: z.boolean().nullable(), brunch: z.boolean().nullable(), coffee: z.boolean().nullable(), dessert: z.boolean().nullable() }),
    service: z.object({ dineIn: z.boolean().nullable(), takeout: z.boolean().nullable() }),
    amenities: z.object({ restroom: z.boolean().nullable(), goodForChildren: z.boolean().nullable(), menuForChildren: z.boolean().nullable(), parking: z.record(z.boolean()).nullable(), accessibility: z.record(z.boolean()).nullable(), payment: z.record(z.boolean()).nullable() }),
    photos: z.array(z.object({ name: z.string(), widthPx: z.number().nullable(), heightPx: z.number().nullable(), authorAttributions: z.array(z.object({ displayName: z.string(), uri: z.string().nullable(), photoUri: z.string().nullable() })) })),
    reviews: z.array(z.object({ rating: z.number().nullable(), text: z.string().nullable(), publishTime: z.string().nullable(), googleMapsUri: z.string().nullable(), author: z.object({ displayName: z.string(), uri: z.string().nullable(), photoUri: z.string().nullable() }).nullable() })),
    attributions: z.array(z.object({ provider: z.string(), providerUri: z.string().nullable() })),
    detailsStatus: z.enum(["not-requested", "available", "unavailable"]),
  }).optional(),
}) satisfies z.ZodType<Recommendation>;

const stage = z.enum(["diet", "cuisine", "meal", "budget", "hours", "detour", "unreachable", "verification"]);

const recommendSchema = z.object({
  requestId: z.string(),
  timeZone: z.literal("Asia/Kolkata"),
  route: z.object({
    index: z.number(),
    geometry: z.array(lngLat),
    durationSec: z.number(),
    distanceM: z.number(),
    summary: z.string(),
    departureTime: z.string(),
    arrivalTime: z.string(),
    alternatives: z.array(z.object({ index: z.number(), durationSec: z.number(), distanceM: z.number(), summary: z.string() })),
  }),
  recommendations: z.array(recommendationSchema),
  excluded: z.array(z.object({ id: z.string(), name: z.string(), stage, reason: z.string() })),
  diagnostics: z.object({
    corridorHalfWidthM: z.number(),
    searchAreas: z.object({ total: z.number(), failed: z.number(), truncated: z.number() }),
    discovered: z.object({ geoapify: z.number(), mapbox: z.number(), google: z.number().optional(), merged: z.number(), malformedDropped: z.number() }),
    inCorridor: z.number(),
    screened: z.number(),
    verified: z.number(),
    notEvaluated: z.number(),
    excludedByStage: z.record(stage, z.number()),
    providers: z.object({ geoapify: providerStatus.optional(), mapbox: providerStatus.optional(), google: providerStatus.optional() }),
    stageMs: z.record(z.string(), z.number()),
    warnings: z.array(z.string()),
  }),
  attribution: z.array(z.string()),
}) satisfies z.ZodType<RecommendResponse>;

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfterSec: z.number().optional(),
    details: z.unknown().optional(),
  }),
});

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError("NETWORK", "Couldn't reach WayDine. Check your connection and try again.");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("INTERNAL", `Something went wrong (HTTP ${res.status}). Please try again.`);
    }
    const details = parsed.data.error.details as { fieldErrors?: Record<string, string[]> } | undefined;
    throw new ApiError(parsed.data.error.code as ApiErrorCode, parsed.data.error.message, {
      retryAfterSec: parsed.data.error.retryAfterSec ?? (Number(res.headers.get("retry-after")) || undefined),
      fieldErrors: details?.fieldErrors,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("MALFORMED", "WayDine received an unexpected response. Please try again.");
  }
  return parsed.data;
}

export function suggestPlaces(q: string, near: LngLat | null, signal: AbortSignal): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q });
  if (near) params.set("near", `${near[0].toFixed(5)},${near[1].toFixed(5)}`);
  return request(`/api/places/suggest?${params}`, suggestSchema, { signal });
}

export function reversePlace(point: LngLat, signal?: AbortSignal): Promise<ReverseResponse> {
  const params = new URLSearchParams({ lng: point[0].toFixed(6), lat: point[1].toFixed(6) });
  return request(`/api/places/reverse?${params}`, reverseSchema, { signal });
}

export function fetchRecommendations(body: RecommendRequest, signal: AbortSignal): Promise<RecommendResponse> {
  return request("/api/google/recommend", recommendSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

const graphRouteSchema = z.object({ geometry: z.array(lngLat).min(2), distanceM: z.number().nonnegative(), durationSec: z.number().nonnegative(), snapDistancesM: z.array(z.number().nonnegative()), warnings: z.array(z.string()), attribution: z.string() });
export type GraphPreview = z.infer<typeof graphRouteSchema>;
export function fetchGraphPreview(body: { source: LngLat; destination: LngLat; stop?: LngLat }, signal: AbortSignal): Promise<GraphPreview> {
  return request("/api/graph/route", graphRouteSchema, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

const authSchema = z.object({ user: z.object({ id: z.string(), email: z.string(), displayName: z.string().nullable(), avatarUrl: z.string().nullable(), provider: z.literal("google"), createdAt: z.string(), lastSignInAt: z.string().nullable() }) }) satisfies z.ZodType<AuthMeResponse>;
const preferenceSchema = z.object({ preferences: z.object({ diet: z.enum(["any", "vegetarian-options", "pure-veg"]), cuisines: z.array(z.enum(["north indian", "south indian", "maharashtrian", "gujarati", "chinese", "pizza", "burger", "biryani", "seafood", "cafe", "bakery", "dessert", "street food"])), includeUnconfirmedDiet: z.boolean(), maxDetourMinutes: z.number(), budgetPerPersonInr: z.number().nullable() }), saved: z.boolean(), updatedAt: z.string().nullable() }) satisfies z.ZodType<UserPreferencesResponse>;
export const getAccount = () => request("/api/auth/me", authSchema);
export const getPreferences = () => request("/api/me/preferences", preferenceSchema);

export function savePreferences(patch: UserPreferencesPatch): Promise<UserPreferencesResponse> {
  return request("/api/me/preferences", preferenceSchema, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
}

export function resetPreferences(): Promise<UserPreferencesResponse> {
  return request("/api/me/preferences", preferenceSchema, { method: "DELETE" });
}

const userPreferencesSchema = preferenceSchema.shape.preferences;
const googleRecommendSchema = recommendSchema.extend({
  preferenceContext: z.object({
    preferences: userPreferencesSchema,
    source: z.enum(["saved", "defaults"]),
    overriddenFields: z.array(z.enum(["diet", "cuisines", "includeUnconfirmedDiet", "maxDetourMinutes", "budgetPerPersonInr"])),
    budgetApplied: z.boolean(),
  }),
}) satisfies z.ZodType<GoogleRecommendResponse>;

/** Google-backed search: saved account preferences apply, with optional per-trip overrides. */
export function fetchGoogleRecommendations(body: GoogleRecommendRequest, signal: AbortSignal): Promise<GoogleRecommendResponse> {
  return request("/api/google/recommend", googleRecommendSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

const googleDetailsSchema = recommendationSchema.shape.google.unwrap();
const restaurantDetailsSchema = z.object({
  restaurant: z.object({
    id: z.string(),
    name: z.string(),
    location: lngLat,
    address: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    cuisines: z.array(z.string()),
    venueType: z.string().nullable(),
    vegetarian: z.enum(["pure-veg", "options", "none", "unknown"]),
    openingHoursText: z.string().nullable(),
    google: googleDetailsSchema.optional(),
  }),
  attribution: z.array(z.string()),
});
export type RestaurantDetails = z.infer<typeof restaurantDetailsSchema>["restaurant"];

/** One billable Google Place Details request (includes up to 5 reviews). */
export function getRestaurantDetails(placeId: string, signal?: AbortSignal) {
  return request(`/api/google/restaurants/${encodeURIComponent(placeId)}`, restaurantDetailsSchema, { signal });
}

/** Image URL for a Google photo reference. Each load is one billable Place Photo request. */
export function googlePhotoUrl(name: string, width = 800): string {
  return `${API_BASE}/api/google/photo?${new URLSearchParams({ name, w: String(width) })}`;
}

const authStatusSchema = z.object({ enabled: z.boolean(), provider: z.literal("google") });
export const getAuthStatus = () => request("/api/auth/status", authStatusSchema);
export const googleSignInUrl = `${API_BASE}/api/auth/google`;
export async function signOut(): Promise<void> {
  let response: Response;
  try { response = await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" }); }
  catch { throw new ApiError("NETWORK", "Couldn't reach WayDine. Check your connection and try again."); }
  if (!response.ok) throw new ApiError("INTERNAL", "Couldn't sign out. Please try again.");
}
