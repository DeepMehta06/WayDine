export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export interface PlaceSuggestion {
  id: string;
  name: string;
  fullAddress: string;
  center: [number, number];
}

const GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];

  const url = `${GEOCODING_URL}/${encodeURIComponent(query)}.json?country=in&types=place,address,poi&limit=5&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    features: Array<{ id: string; text: string; place_name: string; center: [number, number] }>;
  };

  return data.features.map((f) => ({
    id: f.id,
    name: f.text,
    fullAddress: f.place_name,
    center: f.center,
  }));
}
