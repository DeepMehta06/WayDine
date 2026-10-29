/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Mapbox token for map display. Optional: without it the list still works. */
  readonly VITE_MAPBOX_TOKEN?: string;
  /** API origin. Optional: defaults to same-origin `/api` (proxied to the backend in dev). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
