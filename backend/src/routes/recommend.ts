import { Router } from "express";
import { z } from "zod";
import { getRoute } from "../services/mapbox.js";
import { getCandidates } from "../services/candidates.js";
import { classifyDirection } from "../services/direction.js";
import { rankByDetour } from "../services/graph.js";
import { applyMealRules } from "../services/mealRules.js";
import { excludeAndRank } from "../services/ranking.js";
import { supabase } from "../db/supabaseClient.js";
import type { RecommendResponseBody } from "../types/index.js";

export const recommendRouter = Router();

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const requestSchema = z.object({
  source: lngLat,
  destination: lngLat,
  departureTime: z.string().datetime({ offset: true }),
  preferences: z
    .object({
      vegetarian: z.boolean().optional(),
      maxDetourMinutes: z.number().positive().optional(),
      cuisine: z.string().optional(),
    })
    .optional(),
});

recommendRouter.post("/", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { source, destination, departureTime, preferences } = parsed.data;
  const departure = new Date(departureTime);

  try {
    // Stage A: route + 200m candidate filter
    const route = await getRoute(source, destination);
    const candidates = await getCandidates(route.polyline);

    // Stage B: direction + side-of-road classification
    const directionClassified = classifyDirection(candidates, route.polyline);

    // Stage C: candidate graph + Dijkstra -> real detour cost (ΔT) per candidate
    const graphRanked = await rankByDetour(
      directionClassified,
      source,
      destination,
      route.durationSec,
      departure
    );

    // Stage D: time-aware meal recommendation (hours data isn't available from
    // the live POI source, so openAtArrival is left unknown rather than guessed)
    const mealFiltered = applyMealRules(graphRanked, departure);

    // Stage E: hard exclusions, then weighted ranking
    const { ranked, excluded } = excludeAndRank(mealFiltered, preferences);

    void supabase
      .from("search_history")
      .insert({
        source: `POINT(${source[0]} ${source[1]})`,
        destination: `POINT(${destination[0]} ${destination[1]})`,
        departure_time: departureTime,
        preferences: preferences ?? {},
      })
      .then(({ error }) => {
        if (error) console.error("search_history insert failed:", error.message);
      });

    const response: RecommendResponseBody = {
      route: {
        polyline: route.polyline,
        totalDurationMin: Math.round(route.durationSec / 60),
      },
      recommendations: ranked.map((r) => ({
        id: r.id,
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
        etaArrival: r.etaArrival,
        detourMinutes: r.detourMinutes,
        distanceFromRoadM: r.distanceFromRoadM,
        side: r.travelSide,
        cuisine: r.cuisine,
        mealRecommended: r.mealRecommended,
        openAtArrival: r.openAtArrival,
        score: r.score,
        reason: r.reason,
      })),
      excluded,
    };

    res.json(response);
  } catch (err) {
    console.error("recommend pipeline failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});
