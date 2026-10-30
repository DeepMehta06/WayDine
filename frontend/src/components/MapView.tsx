import type { LngLat, Recommendation } from "@contract";
import type { SelectedPlace } from "@/lib/search-state";
import GoogleMapView from "./GoogleMapView";

export interface MapViewProps {
  source: SelectedPlace | null;
  destination: SelectedPlace | null;
  route: LngLat[] | null;
  graphRoute?: LngLat[] | null;
  routeStale: boolean;
  recommendations: Recommendation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEndpointMove: (which: "source" | "destination", point: LngLat) => void;
  onCenterChange: (center: LngLat) => void;
}

export default function MapView(props: MapViewProps) {
  if (import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()) return <GoogleMapView {...props} />;
  return <div role="status" className="flex h-full items-center justify-center bg-muted p-6 text-center text-sm">Configure VITE_GOOGLE_MAPS_API_KEY to show the map.</div>;
}
