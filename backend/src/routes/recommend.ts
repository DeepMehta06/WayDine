import { Router } from "express";
import { z } from "zod";
import { CUISINE_OPTIONS, type RecommendRequest } from "../contract/api.js";
import type { SearchLogger } from "../db/searchLog.js";
import { AppError } from "../errors.js";
import { SharedRun } from "../lib/cache.js";
import { asyncHandler, clientKey } from "../lib/express.js";
import { haversineM, inIndia, type LngLat } from "../lib/geo.js";
import type { ClientRateLimiter } from "../lib/quota.js";
import type { ProviderContext } from "../providers/context.js";
import { recommend } from "../services/recommend.js";

const lngLat = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);

export const MIN_ENDPOINT_SEPARATION_M = 150;
export const SCHEDULE_PAST_TOLERANCE_MIN = 10;
export const SCHEDULE_MAX_AHEAD_DAYS = 14;

export const requestSchema = z.object({
  source: lngLat,
  destination: lngLat,
  departure: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("now") }),
    z.object({ mode: z.literal("at"), time: z.string().datetime({ offset: true }) }),
  ]),
  preferences: z.object({
    diet: z.enum(["any", "vegetarian-options", "pure-veg"]),
    includeUnconfirmedDiet: z.boolean(),
    maxDetourMinutes: z.number().int().min(1).max(60),
    cuisines: z.array(z.enum(CUISINE_OPTIONS)).max(CUISINE_OPTIONS.length),
  }),
  routeIndex: z.number().int().min(0).max(2).optional(),
}) satisfies z.ZodType<RecommendRequest>;

export function validateRecommendRequest(body: unknown, now: Date): { input: z.infer<typeof requestSchema>; departure: Date } {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", "Some trip details are missing or invalid.", { details: parsed.error.flatten() });
  }
  const input = parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  if (!inIndia(input.source as LngLat)) fieldErrors.source = ["WayDine currently supports trips within India."];
  if (!inIndia(input.destination as LngLat)) fieldErrors.destination = ["WayDine currently supports trips within India."];
  if (Object.keys(fieldErrors).length) {
    throw new AppError("OUT_OF_COVERAGE", "WayDine currently supports trips within India.", { details: { fieldErrors } });
  }
  if (haversineM(input.source as LngLat, input.destination as LngLat) < MIN_ENDPOINT_SEPARATION_M) {
    throw new AppError("BAD_REQUEST", "Your start and destination are the same place. Choose a different destination.", {
      details: { fieldErrors: { destination: ["Must differ from the start."] } },
    });
  }

  let departure = now;
  if (input.departure.mode === "at") {
    departure = new Date(input.departure.time);
    const earliest = now.getTime() - SCHEDULE_PAST_TOLERANCE_MIN * 60_000;
    const latest = now.getTime() + SCHEDULE_MAX_AHEAD_DAYS * 86_400_000;
    if (departure.getTime() < earliest) {
      throw new AppError("BAD_REQUEST", "That departure time is in the past. Choose “Leave now” or a later time.", {
        details: { fieldErrors: { departure: ["In the past."] } },
      });
    }
    if (departure.getTime() > latest) {
      throw new AppError("BAD_REQUEST", `Plan trips up to ${SCHEDULE_MAX_AHEAD_DAYS} days ahead; opening hours further out aren't reliable.`, {
        details: { fieldErrors: { departure: ["Too far ahead."] } },
      });
    }
  }
  return { input, departure };
}

export function recommendRouter(ctx: ProviderContext, limiter: ClientRateLimiter, searchLog: SearchLogger): Router {
  const router = Router();
  const shared = new SharedRun<Awaited<ReturnType<typeof recommend>>>();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { input, departure } = validateRecommendRequest(req.body, new Date());
      limiter.check(`recommend:${clientKey(req)}`);
      if (!ctx.mapboxToken) throw new AppError("NOT_CONFIGURED", "Routing is not configured on this server.");

      // Identical concurrent searches share one pipeline run (no provider data is retained afterwards).
      const departureKey = input.departure.mode === "now" ? Math.floor(departure.getTime() / 60_000) : input.departure.time;
      const key = JSON.stringify({ ...input, departure: departureKey });
      const started = Date.now();
      const result = await shared.run(key, req.abortSignal, (signal) =>
        recommend(
          ctx,
          {
            source: input.source as LngLat,
            destination: input.destination as LngLat,
            departure,
            preferences: input.preferences,
            routeIndex: input.routeIndex,
          },
          req.id,
          signal
        )
      );

      searchLog.record({
        routeDistanceKm: result.route.distanceM / 1000,
        maxDetourMinutes: input.preferences.maxDetourMinutes,
        diet: input.preferences.diet,
        cuisineCount: input.preferences.cuisines.length,
        resultCount: result.recommendations.length,
        candidateCount: result.diagnostics.inCorridor,
        durationMs: Date.now() - started,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...result, requestId: req.id });
    })
  );
  return router;
}
