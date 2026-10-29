import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { LOG_LEVEL: "silent", MAPBOX_SECRET_TOKEN: "", GEOAPIFY_API_KEY: "" },
  },
});
