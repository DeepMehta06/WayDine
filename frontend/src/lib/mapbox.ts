/** Public map token. Without it the app still works as a list; the map shows why it's missing. */
export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN ?? "").trim();
