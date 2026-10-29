/**
 * Typed API client. Responses are validated at runtime with schemas that are
 * compile-time tied to the shared backend contract, so a malformed or
 * mismatched response becomes a clear error instead of a broken render.
 */
import { z } from "zod";
import type {
  ApiErrorCode,
  LngLat,
  PlaceSuggestion,
  Recommendation,
  RecommendRequest,
  RecommendResponse,
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
  sources: z.array(z.object({ provider, id: z.string(), url: z.string().optional() })),
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
    source: provider.nullable(),
    text: z.string().nullable(),
  }),
  diet: z.object({ vegetarian: z.enum(["pure-veg", "options", "none", "unknown"]), source: provider.nullable() }),
  mealPeriod: z.enum(["breakfast", "lunch", "snacks", "dinner", "late night"]),
  viaRoute: z.object({ geometry: z.array(lngLat), durationSec: z.number(), distanceM: z.number() }),
  facts: z.array(z.string()),
  uncertainties: z.array(z.string()),
}) satisfies z.ZodType<Recommendation>;

const stage = z.enum(["diet", "cuisine", "hours", "detour", "unreachable", "verification"]);

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
    discovered: z.object({ geoapify: z.number(), mapbox: z.number(), merged: z.number(), malformedDropped: z.number() }),
    inCorridor: z.number(),
    screened: z.number(),
    verified: z.number(),
    notEvaluated: z.number(),
    excludedByStage: z.record(stage, z.number()),
    providers: z.object({ geoapify: providerStatus.optional(), mapbox: providerStatus.optional() }),
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
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: { Accept: "application/json", ...init.headers } });
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
  return request("/api/recommend", recommendSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
