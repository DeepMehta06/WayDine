export type MealType = "breakfast" | "lunch" | "snacks" | "dinner";
export type RoadSide = "left" | "right";

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

export interface Recommendation {
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
  recommendations: Recommendation[];
  excluded: ExcludedRestaurant[];
}
