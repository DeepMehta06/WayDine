export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export interface PlaceSuggestion {
  mapboxId: string;
  name: string;
  fullAddress: string;
}

export interface ResolvedPlace {
  name: string;
  fullAddress: string;
  center: [number, number];
}

const SEARCHBOX_URL = "https://api.mapbox.com/search/searchbox/v1";

export function createSessionToken(): string {
  return crypto.randomUUID();
}

export async function suggestPlaces(
  query: string,
  sessionToken: string
): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];

  const url = `${SEARCHBOX_URL}/suggest?q=${encodeURIComponent(query)}&country=in&language=en&types=place,address,poi&limit=5&session_token=${sessionToken}&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    suggestions: Array<{ mapbox_id: string; name: string; full_address?: string; place_formatted?: string }>;
  };

  return data.suggestions.map((s) => ({
    mapboxId: s.mapbox_id,
    name: s.name,
    fullAddress: s.full_address ?? s.place_formatted ?? s.name,
  }));
}

export async function retrievePlace(
  suggestion: PlaceSuggestion,
  sessionToken: string
): Promise<ResolvedPlace | null> {
  const url = `${SEARCHBOX_URL}/retrieve/${suggestion.mapboxId}?session_token=${sessionToken}&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    features: Array<{
      properties: { name: string; full_address?: string; place_formatted?: string };
      geometry: { coordinates: [number, number] };
    }>;
  };

  const feature = data.features[0];
  if (!feature) return null;

  return {
    name: feature.properties.name,
    fullAddress: feature.properties.full_address ?? feature.properties.place_formatted ?? feature.properties.name,
    center: feature.geometry.coordinates,
  };
}
