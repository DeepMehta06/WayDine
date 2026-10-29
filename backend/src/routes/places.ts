import { Router } from "express";
import { z } from "zod";
import type { ReverseResponse, SuggestResponse } from "../contract/api.js";
import { AppError } from "../errors.js";
import { asyncHandler, clientKey } from "../lib/express.js";
import { inIndia, type LngLat } from "../lib/geo.js";
import type { ClientRateLimiter } from "../lib/quota.js";
import type { ProviderContext } from "../providers/context.js";
import { DEFAULT_BIAS, reversePlace, suggestPlaces } from "../services/places.js";

const lngLatParam = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  .transform((s) => s.split(",").map(Number) as LngLat)
  .refine(([lng, lat]) => Math.abs(lng) <= 180 && Math.abs(lat) <= 90, "Out of range");

const suggestQuery = z.object({
  q: z.string().trim().min(1).max(100),
  near: lngLatParam.optional(),
});

const reverseQuery = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
});

export function placesRouter(ctx: ProviderContext, limiter: ClientRateLimiter): Router {
  const router = Router();

  router.get(
    "/suggest",
    asyncHandler(async (req, res) => {
      const parsed = suggestQuery.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("BAD_REQUEST", "Enter at least one character to search.", { details: parsed.error.flatten() });
      }
      limiter.check(`suggest:${clientKey(req)}`);
      const near = parsed.data.near && inIndia(parsed.data.near) ? parsed.data.near : DEFAULT_BIAS;
      const body: SuggestResponse = await suggestPlaces(ctx, parsed.data.q, near, req.abortSignal);
      res.setHeader("Cache-Control", "no-store");
      res.json(body);
    })
  );

  router.get(
    "/reverse",
    asyncHandler(async (req, res) => {
      const parsed = reverseQuery.safeParse(req.query);
      if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid coordinates.", { details: parsed.error.flatten() });
      const point: LngLat = [parsed.data.lng, parsed.data.lat];
      if (!inIndia(point)) {
        throw new AppError("OUT_OF_COVERAGE", "WayDine currently supports trips within India.");
      }
      limiter.check(`suggest:${clientKey(req)}`);
      const body: ReverseResponse = { place: await reversePlace(ctx, point, req.abortSignal) };
      res.setHeader("Cache-Control", "no-store");
      res.json(body);
    })
  );

  return router;
}
