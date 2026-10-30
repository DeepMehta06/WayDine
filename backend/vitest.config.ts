import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    env: { LOG_LEVEL: "silent", MAPBOX_SECRET_TOKEN: "", GEOAPIFY_API_KEY: "", GOOGLE_PLACES_API_KEY: "", GOOGLE_PLACES_ENABLED: "false" },
  },
});
