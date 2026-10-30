import { Router } from "express";
import { requireAuth, requireTrustedOrigin } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { SearchLogger } from "../db/searchLog.js";
import { AppError } from "../errors.js";
import { asyncHandler, clientKey } from "../lib/express.js";
import { ClientRateLimiter } from "../lib/quota.js";
import type { ProviderContext } from "../providers/context.js";
import { GOOGLE_PHOTO_NAME, googleDetails, googlePhotoUri } from "../providers/google.js";
import { recommendRouter } from "./recommend.js";
import type { PreferencesService } from "../services/preferences.js";
import type { TripHistoryService } from "../services/trips.js";

/** Authenticated Google Places endpoints with explicit request budgets. */
export function googleRouter(config: AppConfig, ctx: ProviderContext, auth: AuthService | null, searchLog: SearchLogger, preferences: PreferencesService | null, trips?: TripHistoryService | null): Router {
  const router = Router();
  const limiter = new ClientRateLimiter(4);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/status", (_req, res) => {
    res.json({ enabled: Boolean(ctx.googlePlacesEnabled), keyConfigured: Boolean(ctx.googlePlacesKey), limits: ctx.googlePlacesLimits ?? { searches: 3, details: 3, corridorM: 200 }, requiresAuthentication: true, liveProviderVerified: false });
  });
  router.use((_req, _res, next) => next(ctx.googlePlacesEnabled && ctx.googlePlacesKey ? undefined : new AppError("NOT_CONFIGURED", "Google Places is disabled. Enable it explicitly only when you intend to make live requests.")));
  router.use(requireAuth(auth, config));
  router.get("/restaurants/:placeId", asyncHandler(async (req, res) => {
    limiter.check(`${req.user!.id}:${clientKey(req)}`);
    const restaurant = await googleDetails(ctx, req.params.placeId!, req.abortSignal, true);
    res.json({ restaurant: {
      id: `google:${restaurant.providerId}`, name: restaurant.name, location: restaurant.location,
      address: restaurant.address, phone: restaurant.phone, website: restaurant.website,
      cuisines: restaurant.cuisineTags, venueType: restaurant.venueType,
      vegetarian: restaurant.vegetarian, openingHoursText: restaurant.hours?.kind === "google" ? restaurant.hours.text : null,
      google: restaurant.google,
    }, attribution: ["Google Maps"] });
  }));
  // Redirects an <img> to Google's short-lived photo URL. Used only on restaurant detail pages.
  const photoLimiter = new ClientRateLimiter(15);
  router.get("/photo", asyncHandler(async (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name : "";
    if (!GOOGLE_PHOTO_NAME.test(name)) throw new AppError("BAD_REQUEST", "Invalid Google photo reference.");
    photoLimiter.check(`${req.user!.id}:${clientKey(req)}`);
    const width = Number(req.query.w) || 800;
    const uri = await googlePhotoUri(ctx, name, width, req.abortSignal);
    res.setHeader("Cache-Control", "private, max-age=600");
    res.redirect(302, uri);
  }));
  router.use("/recommend", requireTrustedOrigin(config), recommendRouter({ ...ctx, restaurantSource: "google" }, new ClientRateLimiter(2), searchLog, preferences, trips));
  return router;
}
