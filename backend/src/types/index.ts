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

export interface RestaurantRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  highway_id: string;
  side: RoadSide;
  cuisine: string | null;
  veg_available: boolean;
  road_access_verified: boolean;
}

export interface OpeningHourRow {
  id: string;
  restaurant_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
  meal_type: MealType;
}

export interface CandidateRestaurant extends RestaurantRow {
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
  openAtArrival: boolean;
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
    openAtArrival: boolean;
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
