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
  SUPABASE_URL: optionalNonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
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
  capabilities: { geoapify: boolean; mapbox: boolean; searchLogging: boolean };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend configuration:\n${issues}`);
  }
  const c = parsed.data;
  const searchLogging =
    c.SEARCH_LOGGING === "on" && Boolean(c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY);
  return {
    ...c,
    capabilities: {
      geoapify: Boolean(c.GEOAPIFY_API_KEY),
      mapbox: Boolean(c.MAPBOX_SECRET_TOKEN),
      searchLogging,
    },
  };
}

export function describeConfigProblems(config: AppConfig): string[] {
  const problems: string[] = [];
  if (!config.capabilities.mapbox) {
    problems.push(
      "MAPBOX_SECRET_TOKEN is not set: routing (Directions/Matrix) is unavailable, so /api/recommend will fail."
    );
  }
  if (!config.capabilities.geoapify) {
    problems.push(
      "GEOAPIFY_API_KEY is not set: place search and restaurant discovery fall back to Mapbox only (no dietary evidence)."
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
