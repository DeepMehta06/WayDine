/**
 * Single source of truth for the HTTP contract between backend and frontend.
 * Must stay dependency-free: the frontend imports it directly via the
 * `@contract` alias, so it may only contain types and plain constants.
 */
export type LngLat = [number, number];

export type Provider = "geoapify" | "mapbox";
/** Backend opt-in integrations; legacy browser contracts keep their existing default. */
export type RestaurantProvider = Provider | "google";

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

/** Account defaults; trip-specific choices remain separate from saved preferences. */
export interface UserPreferences {
  diet: DietPreference;
  cuisines: CuisineId[];
  includeUnconfirmedDiet: boolean;
  maxDetourMinutes: number;
  /** Maximum food spend per person in whole INR; null means no saved limit. */
  budgetPerPersonInr: number | null;
}

export interface UserPreferencesResponse {
  preferences: UserPreferences;
  saved: boolean;
  updatedAt: string | null;
}

export type UserPreferencesPatch = Partial<UserPreferences>;

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

/** Authenticated Google searches use account defaults with optional per-trip overrides. */
export type GoogleRecommendRequest = Omit<RecommendRequest, "preferences"> & {
  preferences?: Partial<UserPreferences>;
  tripLabels?: { source: string; destination: string };
};

export interface TripHistoryEntry {
  id: string;
  sourceLabel: string;
  destinationLabel: string;
  createdAt: string;
  departureTime: string;
  preferences: UserPreferences;
  resultCount: number;
}

export interface TripHistoryResponse {
  trips: TripHistoryEntry[];
  nextCursor: string | null;
}

export interface RecommendationPreferenceContext {
  preferences: UserPreferences;
  source: "saved" | "defaults";
  overriddenFields: Array<keyof UserPreferences>;
  /** True when a per-person budget was applied, even if some prices are unknown. */
  budgetApplied: boolean;
}

export type MealPeriod = "breakfast" | "lunch" | "snacks" | "dinner" | "late night";

export interface MealRecommendation {
  service: "listed" | "not-listed" | "unknown";
  /** General ideas based on the time and listed cuisine, not a verified menu. */
  ideas: string[];
  disclaimer: string;
}

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

/** Route evidence is indicative; geometric side is not proof of highway access. */
export interface RouteAssessment {
  sideOfSelectedRoute: "left" | "right" | "on-route" | "unknown";
  localBearingDegrees: number | null;
  uTurns: {
    status: "reported" | "none-reported" | "unknown";
    /** Null if maneuver data is incomplete. Includes the whole via route. */
    count: number | null;
    additionalToBaseline: "possible" | "none-detected" | "unknown";
  };
  backwardTravelNearStop: {
    status: "possible" | "not-detected" | "unknown";
    /** Approximate backwards progress along the selected route, not road distance. */
    estimatedMetres: number | null;
  };
  routeDivergence: { status: "possible" | "not-detected" | "unknown"; nearBaselineFraction: number | null };
}

export interface Recommendation<P extends RestaurantProvider = RestaurantProvider> {
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
  sources: Array<{ provider: P; id: string; url?: string }>;
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
    source: P | null;
    text: string | null;
  };
  diet: { vegetarian: VegetarianEvidence; source: P | null };
  mealPeriod: MealPeriod;
  mealRecommendation?: MealRecommendation;
  budgetAssessment?: { status: "not-set" | "likely-within" | "unconfirmed"; budgetPerPersonInr: number | null };
  viaRoute: { geometry: LngLat[]; durationSec: number; distanceM: number };
  facts: string[];
  uncertainties: string[];
  /** Omitted by older API versions. Does not assert entrance or crossing safety. */
  routeAssessment?: RouteAssessment;
  /** Available on Google-backed restaurant recommendations. */
  google?: GoogleRestaurantDetails;
  /** Present when WayDine's own graph engine (Dijkstra over OpenStreetMap) computed this stop's route. */
  routing?: {
    engine: "graph";
    /** Extra seconds in the graph's own time model, before scaling to the Google baseline. */
    rawExtraSec: number;
    uTurns: number;
    /** Independent Google Routes result for the best stops; absent when not requested. */
    crossCheck?: { status: "agrees" | "differs" | "unavailable"; googleExtraSec: number | null; differenceSec: number | null };
  };
}

export interface RoutingSummary {
  engine: "graph" | "google";
  /** Why the graph engine was not used when it was configured. */
  fallbackReason?: string;
  graph?: { nodes: number; baselineSec: number; baselineM: number; googleBaselineSec: number; timeScale: number; warnings: string[] };
}

export interface GoogleRestaurantDetails {
  placeId: string;
  googleMapsUri: string | null;
  shortAddress: string | null;
  businessStatus: string | null;
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
  priceRange: { start: { currencyCode: string; units: string; nanos: number } | null; end: { currencyCode: string; units: string; nanos: number } | null } | null;
  servesVegetarianFood: boolean | null;
  meals: { breakfast: boolean | null; lunch: boolean | null; dinner: boolean | null; brunch: boolean | null; coffee: boolean | null; dessert: boolean | null };
  service: { dineIn: boolean | null; takeout: boolean | null };
  amenities: {
    restroom: boolean | null; goodForChildren: boolean | null; menuForChildren: boolean | null;
    parking: Record<string, boolean> | null;
    accessibility: Record<string, boolean> | null;
    payment: Record<string, boolean> | null;
  };
  photos: Array<{ name: string; widthPx: number | null; heightPx: number | null; authorAttributions: Array<{ displayName: string; uri: string | null; photoUri: string | null }> }>;
  reviews: Array<{ rating: number | null; text: string | null; publishTime: string | null; googleMapsUri: string | null; author: { displayName: string; uri: string | null; photoUri: string | null } | null }>;
  attributions: Array<{ provider: string; providerUri: string | null }>;
  detailsStatus: "not-requested" | "available" | "unavailable";
}

export type ExclusionStage =
  | "diet"
  | "cuisine"
  | "meal"
  | "budget"
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

export interface RecommendDiagnostics<P extends RestaurantProvider = RestaurantProvider> {
  corridorHalfWidthM: number;
  /**
   * Search areas spanning the whole route. `truncated` areas returned the
   * provider's maximum page even after refinement, so some places there may
   * be missing; `failed` areas had a provider error.
   */
  searchAreas: { total: number; failed: number; truncated: number };
  discovered: { geoapify: number; mapbox: number; google?: number; merged: number; malformedDropped: number };
  inCorridor: number;
  screened: number;
  verified: number;
  notEvaluated: number;
  excludedByStage: Partial<Record<ExclusionStage, number>>;
  providers: Partial<Record<P, ProviderStatus>>;
  stageMs: Record<string, number>;
  warnings: string[];
}

export interface RecommendResponse<P extends RestaurantProvider = RestaurantProvider> {
  requestId: string;
  timeZone: "Asia/Kolkata";
  route: RouteSummary;
  routing?: RoutingSummary;
  recommendations: Recommendation<P>[];
  excluded: ExcludedPlace[];
  diagnostics: RecommendDiagnostics<P>;
  attribution: string[];
}

export type GoogleRecommendResponse = RecommendResponse<RestaurantProvider> & {
  preferenceContext: RecommendationPreferenceContext;
  history?: { saved: boolean };
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "AUTH_FAILED"
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

/** Public account data only. Provider tokens and session identifiers never appear here. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  provider: "google";
  createdAt: string;
  lastSignInAt: string | null;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryAfterSec?: number;
    details?: unknown;
    requestId?: string;
  };
}
