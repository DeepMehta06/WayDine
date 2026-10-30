import { useEffect, useRef, useState } from "react";
import type { LngLat } from "@contract";
import type { MapViewProps } from "./MapView";

type Point = { lat: number; lng: number };
type Position = { lat(): number; lng(): number };
type Listener = { remove(): void };
type MapInstance = { getCenter(): Position | undefined; setCenter(point: Point): void; setZoom(zoom: number): void; fitBounds(bounds: Bounds, padding: number): void; addListener(event: string, callback: () => void): Listener };
type Bounds = { extend(point: Point): void };
type Overlay = { setMap(map: MapInstance | null): void };
type Marker = Overlay & { addListener(event: string, callback: () => void): Listener; getPosition(): Position | null };
type MapsApi = {
  Map: new (element: HTMLElement, options: object) => MapInstance;
  Marker: new (options: object) => Marker;
  Polyline: new (options: object) => Overlay;
  LatLngBounds: new () => Bounds;
  SymbolPath: { CIRCLE: number };
};
declare global {
  interface Window {
    google?: { maps: MapsApi };
    waydineMapReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let loading: Promise<MapsApi> | undefined;
function loadMaps(key: string): Promise<MapsApi> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise<MapsApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => fail(), 20000);
    const fail = () => {
      window.clearTimeout(timeout);
      delete window.waydineMapReady;
      script.remove();
      loading = undefined;
      reject(new Error("Google Maps could not load"));
    };
    window.waydineMapReady = () => {
      window.clearTimeout(timeout);
      delete window.waydineMapReady;
      if (window.google?.maps?.Map) resolve(window.google.maps);
      else fail();
    };
    script.onerror = fail;
    const params = new URLSearchParams({ key, loading: "async", callback: "waydineMapReady", v: "weekly" });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    document.head.appendChild(script);
  });
  return loading;
}

const point = ([lng, lat]: LngLat): Point => ({ lat, lng });

export default function GoogleMapView(props: MapViewProps) {
  const { source, destination, route, graphRoute, routeStale, recommendations, selectedId } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const apiRef = useRef<MapsApi | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const selected = recommendations.find((r) => r.id === selectedId);

  useEffect(() => {
    let cancelled = false;
    let listener: Listener | undefined;
    window.gm_authFailure = () => { if (!cancelled) setFailure("Google Maps couldn't authenticate. Check the browser key and API settings."); };
    void loadMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY!.trim()).then((api) => {
      if (cancelled || !container.current) return;
      apiRef.current = api;
      const map = new api.Map(container.current, { center: point([72.8777, 19.076]), zoom: 10, mapTypeControl: false, streetViewControl: false });
      mapRef.current = map;
      listener = map.addListener("idle", () => {
        const center = map.getCenter();
        if (center) callbacks.current.onCenterChange([center.lng(), center.lat()]);
      });
      setReady(true);
    }).catch(() => { if (!cancelled) setFailure("Google Maps couldn't load. Check your connection and key."); });
    return () => { cancelled = true; listener?.remove(); mapRef.current = null; delete window.gm_authFailure; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, api = apiRef.current;
    if (!ready || !map || !api) return;
    const overlays: Overlay[] = [];
    const listeners: Listener[] = [];
    if (route && route.length > 1) overlays.push(new api.Polyline({ map, path: route.map(point), strokeColor: "#2f4f2f", strokeWeight: 5, strokeOpacity: routeStale ? 0.35 : selected ? 0.45 : 0.9 }));
    if (selected && selected.viaRoute.geometry.length > 1) overlays.push(new api.Polyline({ map, path: selected.viaRoute.geometry.map(point), strokeColor: "#c2780f", strokeWeight: 4, strokeOpacity: 0.9 }));
    if (graphRoute && graphRoute.length > 1) overlays.push(new api.Polyline({ map, path: graphRoute.map(point), strokeColor: "#1d4ed8", strokeWeight: 5, strokeOpacity: 0.95, zIndex: 10 }));
    for (const [place, label, which] of [[source, "A", "source"], [destination, "B", "destination"]] as const) {
      if (!place) continue;
      const marker = new api.Marker({ map, position: point(place.coordinates), label, title: `${place.name}. Drag to the exact spot.`, draggable: true });
      listeners.push(marker.addListener("dragend", () => { const p = marker.getPosition(); if (p) callbacks.current.onEndpointMove(which, [p.lng(), p.lat()]); }));
      overlays.push(marker);
    }
    for (const rec of recommendations) {
      const active = rec.id === selectedId;
      const marker = new api.Marker({ map, position: point(rec.location), title: `${rec.rank}. ${rec.name}`, label: { text: String(rec.rank), color: "white" }, icon: { path: api.SymbolPath.CIRCLE, scale: active ? 16 : 13, fillColor: active ? "#c2780f" : "#2f4f2f", fillOpacity: 1, strokeColor: "white", strokeWeight: 2 }, zIndex: active ? 2 : 1 });
      listeners.push(marker.addListener("click", () => callbacks.current.onSelect(rec.id)));
      overlays.push(marker);
    }
    return () => { listeners.forEach((listener) => listener.remove()); overlays.forEach((overlay) => overlay.setMap(null)); };
  }, [ready, source, destination, route, graphRoute, routeStale, recommendations, selected, selectedId]);

  const endpointKey = `${source?.coordinates.join(",")}|${destination?.coordinates.join(",")}`;
  useEffect(() => {
    const map = mapRef.current, api = apiRef.current;
    if (!ready || !map || !api) return;
    const points = graphRoute ?? selected?.viaRoute.geometry ?? route ?? [source?.coordinates, destination?.coordinates].filter((p): p is LngLat => Boolean(p));
    if (points.length === 1) { map.setCenter(point(points[0]!)); map.setZoom(14); }
    else if (points.length > 1) { const bounds = new api.LatLngBounds(); points.forEach((p) => bounds.extend(point(p))); map.fitBounds(bounds, 56); }
  }, [ready, selectedId, route, graphRoute, endpointKey]);

  return <div className="relative h-full w-full bg-muted">
    <div ref={container} className="h-full w-full" aria-label="Map of your route and stops" role="region" />
    {failure && <div role="status" className="absolute inset-0 flex items-center justify-center bg-muted/95 p-6 text-center text-sm text-muted-foreground">{failure} Stops are still listed.</div>}
    {!failure && (source || destination) && !route && <p className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">Drag A or B to the exact spot, such as an entrance</p>}
  </div>;
}
