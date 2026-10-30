/**
 * Central, validated runtime configuration. Startup fails with an actionable
 * message when a required capability is misconfigured; optional capabilities
 * (search logging) are disabled rather than crashing the process.
 */
import "dotenv/config";
import { z } from "zod";

const optionalNonEmpty = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  PORT: positiveInt(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MAPBOX_SECRET_TOKEN: optionalNonEmpty,
  GEOAPIFY_API_KEY: optionalNonEmpty,
  GOOGLE_PLACES_API_KEY: optionalNonEmpty,
  GOOGLE_ROUTES_API_KEY: optionalNonEmpty,
  OSM_GRAPH_PATH: optionalNonEmpty,
  OSM_GRAPH_SOURCE: z.enum(["file", "overpass"]).default("file"),
  GOOGLE_ROUTES_PER_DAY: positiveInt(100),
  GOOGLE_ROUTE_MATRIX_ELEMENTS_PER_DAY: positiveInt(300),
  GOOGLE_PLACES_ENABLED: z.enum(["true", "false"]).default("false"),
  GOOGLE_PLACES_NEARBY_PER_DAY: positiveInt(10),
  GOOGLE_PLACES_DETAILS_PER_DAY: positiveInt(20),
  GOOGLE_PLACES_NEARBY_PER_MONTH: positiveInt(100),
  GOOGLE_PLACES_DETAILS_PER_MONTH: positiveInt(100),
  GOOGLE_PLACES_SEARCHES_PER_REQUEST: z.coerce.number().int().min(2).max(10).default(3),
  GOOGLE_PLACES_DETAILS_PER_REQUEST: z.coerce.number().int().min(1).max(8).default(3),
  GOOGLE_PLACES_CORRIDOR_M: z.coerce.number().int().min(50).max(1000).default(200),
  GOOGLE_PLACES_QUOTA_FILE: z.string().default(".data/google-places-monthly.json"),
  SUPABASE_URL: optionalNonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
  SUPABASE_PUBLISHABLE_KEY: optionalNonEmpty,
  AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTH_ENCRYPTION_KEY: optionalNonEmpty,
  AUTH_CALLBACK_URL: z.string().url().default("http://localhost:4000/api/auth/callback"),
  AUTH_FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SEARCH_LOGGING: z.enum(["on", "off"]).default("off"),
  QUOTA_STATE_FILE: z.string().default(".data/quota-state.json"),
  // Daily ceilings, kept under each provider's free allowance (see README "Free-tier budget").
  BUDGET_GEOAPIFY_CREDITS_PER_DAY: positiveInt(2700),
  BUDGET_MAPBOX_GEOCODE_PER_DAY: positiveInt(2900),
  BUDGET_MAPBOX_SEARCHBOX_PER_DAY: positiveInt(725),
  BUDGET_MAPBOX_DIRECTIONS_PER_DAY: positiveInt(2900),
  BUDGET_MAPBOX_MATRIX_ELEMENTS_PER_DAY: positiveInt(2900),
  CLIENT_RECOMMEND_PER_MINUTE: positiveInt(6),
  CLIENT_SUGGEST_PER_MINUTE: positiveInt(90),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  capabilities: { geoapify: boolean; mapbox: boolean; googlePlaces: boolean; searchLogging: boolean; auth: boolean };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend configuration:\n${issues}`);
  }
  const c = parsed.data;
  if (c.GOOGLE_PLACES_ENABLED === "true" && !c.GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_ENABLED=true requires GOOGLE_PLACES_API_KEY.");
  }
  if (c.AUTH_ENABLED === "true") {
    const missing = (["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AUTH_ENCRYPTION_KEY"] as const).filter((key) => !c[key]);
    if (missing.length) throw new Error(`Google authentication requires: ${missing.join(", ")}`);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(c.AUTH_ENCRYPTION_KEY!) || Buffer.from(c.AUTH_ENCRYPTION_KEY!, "base64").length !== 32) {
      throw new Error("AUTH_ENCRYPTION_KEY must be a base64-encoded 32-byte random key.");
    }
    for (const key of ["SUPABASE_URL", "AUTH_CALLBACK_URL", "AUTH_FRONTEND_URL"] as const) {
      const url = new URL(c[key]!);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
        throw new Error(`${key} must use HTTPS (HTTP is allowed on localhost only), with no credentials or fragment.`);
      }
      if (key !== "SUPABASE_URL" && !local && c.AUTH_COOKIE_SECURE !== "true") throw new Error("Hosted authentication requires AUTH_COOKIE_SECURE=true.");
    }
    if (new URL(c.AUTH_CALLBACK_URL).search) throw new Error("AUTH_CALLBACK_URL must not include a query string.");
    if (!c.CORS_ORIGIN.split(",").map((origin) => origin.trim()).includes(new URL(c.AUTH_FRONTEND_URL).origin)) {
      throw new Error("CORS_ORIGIN must include the AUTH_FRONTEND_URL origin.");
    }
    if (new URL(c.AUTH_CALLBACK_URL).origin === new URL(c.AUTH_FRONTEND_URL).origin && new URL(c.AUTH_CALLBACK_URL).pathname === new URL(c.AUTH_FRONTEND_URL).pathname) {
      throw new Error("AUTH_FRONTEND_URL must not redirect back to the authentication callback.");
    }
  }
  const searchLogging =
    c.SEARCH_LOGGING === "on" && Boolean(c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY);
  return {
    ...c,
    capabilities: {
      geoapify: Boolean(c.GEOAPIFY_API_KEY),
      mapbox: Boolean(c.MAPBOX_SECRET_TOKEN),
      googlePlaces: c.GOOGLE_PLACES_ENABLED === "true" && Boolean(c.GOOGLE_PLACES_API_KEY),
      searchLogging,
      auth: c.AUTH_ENABLED === "true",
    },
  };
}

export function describeConfigProblems(config: AppConfig): string[] {
  const problems: string[] = [];
  if (!config.GOOGLE_ROUTES_API_KEY) problems.push("GOOGLE_ROUTES_API_KEY is not set: route recommendations are unavailable.");
  if (!config.capabilities.geoapify) {
    problems.push(
      "GEOAPIFY_API_KEY is not set: legacy place search and restaurant discovery are unavailable."
    );
  }
  if (config.SEARCH_LOGGING === "on" && !config.capabilities.searchLogging) {
    problems.push(
      "SEARCH_LOGGING=on but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing: logging stays disabled."
    );
  }
  return problems;
}

export const config = loadConfig();
