/**
 * Single source of truth for the HTTP contract between backend and frontend.
 * Must stay dependency-free: the frontend imports it directly via the
 * `@contract` alias, so it may only contain types and plain constants.
 */
export type LngLat = [number, number];

export type Provider = "geoapify" | "mapbox";

export type PlaceKind =
  | "neighbourhood"
  | "locality"
  | "suburb"
  | "district"
  | "city"
  | "region"
  | "postcode"
  | "street"
  | "address"
  | "poi";

export interface PlaceSuggestion {
  id: string;
  /** The name the user chose, e.g. "Kandivali West". Never replaced by the address. */
  name: string;
  /** Context such as "Mumbai, Maharashtra" or a street address. */
  secondary: string | null;
  kind: PlaceKind;
  coordinates: LngLat;
  source: Provider;
}

export type ProviderStatus = "ok" | "error" | "disabled" | "skipped" | "quota";

export interface SuggestResponse {
  suggestions: PlaceSuggestion[];
  providers: Partial<Record<Provider, ProviderStatus>>;
  /** True when at least one provider failed and results may be incomplete. */
  partial: boolean;
}

export interface ReverseResponse {
  place: PlaceSuggestion | null;
}

export const CUISINE_OPTIONS = [
  "north indian",
  "south indian",
  "maharashtrian",
  "gujarati",
  "chinese",
  "pizza",
  "burger",
  "biryani",
  "seafood",
  "cafe",
  "bakery",
  "dessert",
  "street food",
] as const;
export type CuisineId = (typeof CUISINE_OPTIONS)[number];

export type DietPreference = "any" | "vegetarian-options" | "pure-veg";

export interface RecommendRequest {
  source: LngLat;
  destination: LngLat;
  departure: { mode: "now" } | { mode: "at"; time: string };
  preferences: {
    diet: DietPreference;
    /** Explicit opt-in to see places whose dietary information is unconfirmed. */
    includeUnconfirmedDiet: boolean;
    maxDetourMinutes: number;
    cuisines: CuisineId[];
  };
  /** Which of the returned route options to treat as the baseline (0 = fastest). */
  routeIndex?: number;
}

export type MealPeriod = "breakfast" | "lunch" | "snacks" | "dinner" | "late night";

export type VegetarianEvidence = "pure-veg" | "options" | "none" | "unknown";

export interface RouteOption {
  index: number;
  durationSec: number;
  distanceM: number;
  summary: string;
}

export interface RouteSummary {
  index: number;
  geometry: LngLat[];
  durationSec: number;
  distanceM: number;
  summary: string;
  departureTime: string;
  arrivalTime: string;
  alternatives: RouteOption[];
}

export interface Recommendation {
  id: string;
  rank: number;
  name: string;
  venueType: string | null;
  cuisines: string[];
  location: LngLat;
  /** Coordinate the via-route was computed to (provider access point when available). */
  routedTo: LngLat;
  address: string | null;
  phone: string | null;
  website: string | null;
  /** `url` is a public listing (e.g. the OpenStreetMap object) when one exists. */
  sources: Array<{ provider: Provider; id: string; url?: string }>;
  arrivalTime: string;
  extraTimeSec: number;
  extraDistanceM: number;
  destinationArrivalTime: string;
  /** Straight-line distance from the baseline route; not a driving distance. */
  straightLineFromRouteM: number;
  routePositionM: number;
  access: {
    basis: "provider-access-point" | "listing-coordinate";
    /** Distance between the routed coordinate and where the route actually stops. */
    snapDistanceM: number;
    confidence: "good" | "uncertain";
  };
  openingHours: {
    atArrival: "open" | "closed" | "unknown";
    closesWithinMinutes: number | null;
    source: Provider | null;
    text: string | null;
  };
  diet: { vegetarian: VegetarianEvidence; source: Provider | null };
  mealPeriod: MealPeriod;
  viaRoute: { geometry: LngLat[]; durationSec: number; distanceM: number };
  facts: string[];
  uncertainties: string[];
}

export type ExclusionStage =
  | "diet"
  | "cuisine"
  | "hours"
  | "detour"
  | "unreachable"
  | "verification";

export interface ExcludedPlace {
  id: string;
  name: string;
  stage: ExclusionStage;
  reason: string;
}

export interface RecommendDiagnostics {
  corridorHalfWidthM: number;
  /**
   * Search areas spanning the whole route. `truncated` areas returned the
   * provider's maximum page even after refinement, so some places there may
   * be missing; `failed` areas had a provider error.
   */
  searchAreas: { total: number; failed: number; truncated: number };
  discovered: { geoapify: number; mapbox: number; merged: number; malformedDropped: number };
  inCorridor: number;
  screened: number;
  verified: number;
  notEvaluated: number;
  excludedByStage: Partial<Record<ExclusionStage, number>>;
  providers: Partial<Record<Provider, ProviderStatus>>;
  stageMs: Record<string, number>;
  warnings: string[];
}

export interface RecommendResponse {
  requestId: string;
  timeZone: "Asia/Kolkata";
  route: RouteSummary;
  recommendations: Recommendation[];
  excluded: ExcludedPlace[];
  diagnostics: RecommendDiagnostics;
  attribution: string[];
}

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "OUT_OF_COVERAGE"
  | "NO_ROUTE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "CANCELLED"
  | "INTERNAL";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryAfterSec?: number;
    details?: unknown;
    requestId?: string;
  };
}
