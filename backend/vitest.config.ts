import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Blank every provider credential so dotenv can't inject real keys into tests.
    env: {
      LOG_LEVEL: "silent",
      MAPBOX_SECRET_TOKEN: "",
      GEOAPIFY_API_KEY: "",
      GOOGLE_PLACES_API_KEY: "",
      GOOGLE_PLACES_ENABLED: "false",
      GOOGLE_ROUTES_API_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_PUBLISHABLE_KEY: "",
      AUTH_ENABLED: "false",
      AUTH_ENCRYPTION_KEY: "",
      OSM_GRAPH_SOURCE: "file",
      OSM_GRAPH_PATH: "",
      ROUTING_ENGINE: "google",
    },
  },
});
