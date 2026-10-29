/**
 * Map view (lazy-loaded). All drawing waits for a single `ready` flag set on
 * the style's load event, so no effect registers its own load listener that
 * could fire later against stale data or a removed map.
 */
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LngLat, Recommendation } from "@contract";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import { useReducedMotion } from "@/lib/motion";
import type { SelectedPlace } from "@/lib/search-state";

export interface MapViewProps {
  source: SelectedPlace | null;
  destination: SelectedPlace | null;
  route: LngLat[] | null;
  routeStale: boolean;
  recommendations: Recommendation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEndpointMove: (which: "source" | "destination", point: LngLat) => void;
  onCenterChange: (center: LngLat) => void;
}

const MUMBAI: LngLat = [72.8777, 19.076];
const ROUTE = "waydine-route";
const VIA = "waydine-via";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const line = (coords: LngLat[] | null): GeoJSON.FeatureCollection =>
  coords && coords.length > 1 ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] } : EMPTY;

function boundsOf(points: LngLat[]): mapboxgl.LngLatBounds | null {
  if (points.length === 0) return null;
  return points.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(points[0], points[0]));
}

function endpointElement(label: "A" | "B", name: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className =
    "flex size-8 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow-[0_2px_6px_rgb(0_0_0/0.35)] cursor-grab active:cursor-grabbing " +
    (label === "A" ? "bg-foreground text-background" : "bg-accent text-accent-foreground");
  el.textContent = label;
  el.title = `${label === "A" ? "Start" : "Destination"}: ${name}. Drag to the exact spot.`;
  return el;
}

export default function MapView(props: MapViewProps) {
  const { source, destination, route, routeStale, recommendations, selectedId, onSelect, onEndpointMove, onCenterChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef(new Map<string, mapboxgl.Marker>());
  const endpointRef = useRef<{ A?: mapboxgl.Marker; B?: mapboxgl.Marker }>({});
  const callbacks = useRef({ onSelect, onEndpointMove, onCenterChange });
  callbacks.current = { onSelect, onEndpointMove, onCenterChange };
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(MAPBOX_TOKEN ? null : "The map isn't configured (VITE_MAPBOX_TOKEN is missing). Stops are still listed.");
  const reduced = useReducedMotion();
  const duration = (ms: number) => (reduced ? 0 : ms);

  // Map lifecycle and asynchronous failure handling.
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return;
    let map: mapboxgl.Map;
    try {
      mapboxgl.accessToken = MAPBOX_TOKEN;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: MUMBAI,
        zoom: 10,
        customAttribution: "Listings © OpenStreetMap contributors · Powered by Geoapify",
      });
    } catch {
      setFailure("This device couldn't start the map (WebGL unavailable). Stops are still listed.");
      return;
    }
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource(ROUTE, { type: "geojson", data: EMPTY });
      map.addSource(VIA, { type: "geojson", data: EMPTY });
      map.addLayer({ id: ROUTE, type: "line", source: ROUTE, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2f4f2f", "line-width": 5, "line-opacity": 0.9 } });
      map.addLayer({
        id: VIA,
        type: "line",
        source: VIA,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#c2780f", "line-width": 4, "line-dasharray": [1.2, 1.2] },
      });
      setReady(true);
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      callbacks.current.onCenterChange([c.lng, c.lat]);
    });
    map.on("error", (e) => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) setFailure("The map couldn't load (the map token was rejected). Stops are still listed.");
      else if (!map.isStyleLoaded() && !map.loaded()) setFailure("The map couldn't load. Check your connection; stops are still listed.");
    });
    const canvas = map.getCanvas();
    const onContextLost = () => setFailure("The map stopped responding on this device. Stops are still listed; reload to restore the map.");
    canvas.addEventListener("webglcontextlost", onContextLost);

    const markers = markersRef.current;
    const endpoints = endpointRef.current;
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      for (const m of markers.values()) m.remove();
      markers.clear();
      endpoints.A?.remove();
      endpoints.B?.remove();
      endpointRef.current = {};
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Route and via-route layers; null data clears them (no stale geometry after a failed search).
  const selected = recommendations.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource(ROUTE) as mapboxgl.GeoJSONSource).setData(line(route));
    (map.getSource(VIA) as mapboxgl.GeoJSONSource).setData(line(selected?.viaRoute.geometry ?? null));
    map.setPaintProperty(ROUTE, "line-opacity", routeStale ? 0.35 : selected ? 0.45 : 0.9);
  }, [ready, route, selected, routeStale]);

  // Draggable endpoint pins for confirming exact start/destination points.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const sync = (key: "A" | "B", place: SelectedPlace | null, which: "source" | "destination") => {
      const existing = endpointRef.current[key];
      if (!place) {
        existing?.remove();
        delete endpointRef.current[key];
        return;
      }
      if (existing) {
        existing.setLngLat(place.coordinates);
        existing.getElement().title = `${key === "A" ? "Start" : "Destination"}: ${place.name}. Drag to the exact spot.`;
        return;
      }
      const marker = new mapboxgl.Marker({ element: endpointElement(key, place.name), draggable: true }).setLngLat(place.coordinates).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        callbacks.current.onEndpointMove(which, [p.lng, p.lat]);
      });
      endpointRef.current[key] = marker;
    };
    sync("A", source, "source");
    sync("B", destination, "destination");
  }, [ready, source, destination]);

  // Stop markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const m of markersRef.current.values()) m.remove();
    markersRef.current.clear();
    for (const rec of recommendations) {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `${rec.rank}. ${rec.name}`);
      el.className =
        "flex size-7 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-semibold text-primary-foreground shadow-[0_2px_6px_rgb(0_0_0/0.3)] transition-transform";
      el.textContent = String(rec.rank);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.current.onSelect(rec.id);
      });
      markersRef.current.set(rec.id, new mapboxgl.Marker({ element: el }).setLngLat(rec.location).addTo(map));
    }
  }, [ready, recommendations]);

  // Selection highlight, including clearing it when nothing is selected.
  useEffect(() => {
    for (const [id, m] of markersRef.current) {
      const el = m.getElement();
      const on = id === selectedId;
      el.classList.toggle("bg-accent", on);
      el.classList.toggle("text-accent-foreground", on);
      el.classList.toggle("bg-primary", !on);
      el.classList.toggle("scale-125", on);
      el.style.zIndex = on ? "2" : "";
      if (on) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    }
  }, [selectedId, recommendations]);

  // Camera: selected via-route, else the route, else the chosen endpoints.
  const endpointKey = `${source?.coordinates.join(",")}|${destination?.coordinates.join(",")}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts: LngLat[] = selected
      ? selected.viaRoute.geometry
      : route ?? [source?.coordinates, destination?.coordinates].filter((p): p is LngLat => Boolean(p));
    const b = boundsOf(pts);
    if (!b) return;
    if (pts.length === 1) map.easeTo({ center: pts[0], zoom: 14, duration: duration(500) });
    else map.fitBounds(b, { padding: 56, maxZoom: 16, duration: duration(600) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId, route, endpointKey]);

  return (
    <div className="relative h-full w-full bg-muted">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of your route and stops" role="region" />
      {failure && (
        <div role="status" className="absolute inset-0 flex items-center justify-center bg-muted/95 p-6 text-center text-sm text-muted-foreground">
          {failure}
        </div>
      )}
      {!failure && (source || destination) && !route && (
        <p className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          Drag A or B to the exact spot, such as an entrance
        </p>
      )}
    </div>
  );
}
