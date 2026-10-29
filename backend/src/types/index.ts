export type MealType = "breakfast" | "lunch" | "snacks" | "dinner";
export type RoadSide = "left" | "right";

export interface LngLat {
  lng: number;
  lat: number;
}

export interface RecommendPreferences {
  vegetarian?: boolean;
  maxDetourMinutes?: number;
  cuisine?: string;
}

export interface RecommendRequestBody {
  source: [number, number];
  destination: [number, number];
  departureTime: string;
  preferences?: RecommendPreferences;
}

export interface OpeningPeriod {
  /** 0 = Sunday, matching JS Date#getDay(). */
  weekday: number;
  opens_at: string;
  closes_at: string;
}

/**
 * A restaurant candidate sourced live from Mapbox's Search Box category API
 * (not a curated DB row). `vegAvailable` is null when the live source has no
 * dietary tag for this POI — unknown, not "no veg options". `openingHours` is
 * an empty array when Mapbox has no hours data for this specific place.
 */
export interface CandidateRestaurant {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  cuisine: string | null;
  vegAvailable: boolean | null;
  openingHours: OpeningPeriod[];
  distanceFromRoadM: number;
  nearestRouteIndex: number;
}

export interface DirectionClassifiedRestaurant extends CandidateRestaurant {
  travelSide: RoadSide;
  matchesRouteDirection: boolean;
}

export interface GraphRankedRestaurant extends DirectionClassifiedRestaurant {
  detourMinutes: number;
  etaArrival: string;
}

export interface MealFilteredRestaurant extends GraphRankedRestaurant {
  mealRecommended: MealType;
  /** null when the live POI source has no hours data for this place — unknown, not closed. */
  openAtArrival: boolean | null;
}

export interface RankedRestaurant extends MealFilteredRestaurant {
  score: number;
  reason: string;
}

export interface ExcludedRestaurant {
  id: string;
  name: string;
  reason: string;
}

export interface RouteSummary {
  polyline: [number, number][];
  totalDurationMin: number;
}

export interface RecommendResponseBody {
  route: RouteSummary;
  recommendations: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    etaArrival: string;
    detourMinutes: number;
    distanceFromRoadM: number;
    side: RoadSide;
    cuisine: string | null;
    mealRecommended: MealType;
    openAtArrival: boolean | null;
    score: number;
    reason: string;
  }>;
  excluded: ExcludedRestaurant[];
}

export interface MapboxDirectionsResult {
  polyline: [number, number][];
  durationSec: number;
  distanceM: number;
}
