import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import { asyncHandler, clientKey } from "../lib/express.js";
import { inIndia } from "../lib/geo.js";
import { ClientRateLimiter } from "../lib/quota.js";
import { createGraphLoader, makeGraphPreview } from "../graph/preview.js";
import { fetchRoadGraph } from "../graph/overpass.js";

const point = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const body = z.object({ source: point, destination: point, stop: point.optional() }).strict();
export function graphRouter(path?: string, sourceMode: "file" | "overpass" = "file", fetchImpl: typeof fetch = fetch): Router {
  const router = Router(); const load = createGraphLoader(path); const limiter = new ClientRateLimiter(6);
  let active = false; let lastOverpassRequest = 0;
  router.post("/route", asyncHandler(async (req, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid route coordinates.");
    const { source, destination, stop } = parsed.data;
    if (![source, destination, ...(stop ? [stop] : [])].every(inIndia)) throw new AppError("OUT_OF_COVERAGE", "WayDine currently supports trips within India.");
    limiter.check(clientKey(req));
    if (active) throw new AppError("RATE_LIMITED", "A graph route is already being calculated. Try again shortly.", { retryAfterSec: 5 });
    if (sourceMode === "overpass" && lastOverpassRequest && Date.now() - lastOverpassRequest < 30_000) {
      throw new AppError("RATE_LIMITED", "Please wait before requesting more OpenStreetMap road data.", { retryAfterSec: Math.ceil((30_000 - (Date.now() - lastOverpassRequest)) / 1000) });
    }
    active = true;
    try {
      if (sourceMode === "overpass") lastOverpassRequest = Date.now();
      const graph = sourceMode === "overpass" ? await fetchRoadGraph(source, destination, fetchImpl, req.abortSignal) : await load();
      res.setHeader("Cache-Control", "no-store");
      res.json(makeGraphPreview(graph, source, destination, stop));
    } finally { active = false; }
  }));
  return router;
}
