import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import type { Recommendation, RouteSummary } from "@/types";

mapboxgl.accessToken = MAPBOX_TOKEN;

interface MapViewProps {
  route: RouteSummary | null;
  recommendations: Recommendation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const ROUTE_SOURCE_ID = "waydine-route";
const INDIA_CENTER: [number, number] = [78.9629, 22.5937];

export function MapView({ route, recommendations, selectedId, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: INDIA_CENTER,
      zoom: 5,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const activeRoute = route;
    if (!map || !activeRoute) return;

    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: activeRoute.polyline },
    };

    function draw() {
      const source = map!.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geojson);
      } else {
        map!.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: geojson });
        map!.addLayer({
          id: ROUTE_SOURCE_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#2f4f2f", "line-width": 4 },
        });
      }

      const polyline = activeRoute!.polyline;
      const bounds = polyline.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new mapboxgl.LngLatBounds(polyline[0], polyline[0])
      );
      map!.fitBounds(bounds, { padding: 60, duration: 800 });
    }

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const rec of recommendations) {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `${rec.name}, ${rec.detourMinutes} minute detour`);
      el.className =
        "flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-semibold text-primary-foreground shadow-md transition-transform hover:scale-110";
      el.textContent = String(recommendations.indexOf(rec) + 1);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(rec.id);
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([rec.longitude, rec.latitude])
        .addTo(map);

      markersRef.current.set(rec.id, marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (marker) {
      map.flyTo({ center: marker.getLngLat(), zoom: 13, duration: 600 });
    }
    for (const [id, m] of markersRef.current) {
      m.getElement().classList.toggle("ring-2", id === selectedId);
      m.getElement().classList.toggle("ring-accent", id === selectedId);
      m.getElement().classList.toggle("scale-110", id === selectedId);
    }
  }, [selectedId]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground">
        Map unavailable: VITE_MAPBOX_TOKEN is not set.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
