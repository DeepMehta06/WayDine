import { Router } from "express";
import { requireAuth, requireTrustedOrigin } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { asyncHandler, clientKey } from "../lib/express.js";
import { ClientRateLimiter } from "../lib/quota.js";
import type { PreferencesService } from "../services/preferences.js";

export function preferencesRouter(config: AppConfig, auth: AuthService | null, service: PreferencesService | null): Router {
  const router = Router();
  const reads = new ClientRateLimiter(60);
  const writes = new ClientRateLimiter(20);
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    try { reads.check(clientKey(req)); next(); } catch (error) { next(error); }
  });
  router.use(requireAuth(auth, config));
  router.use((_req, _res, next) => next(service ? undefined : new AppError("NOT_CONFIGURED", "Saved preferences are not configured on this server.")));
  router.get("/", asyncHandler(async (req, res) => {
    res.json(await service!.get(req.user!.id));
  }));
  router.patch("/", requireTrustedOrigin(config), asyncHandler(async (req, res) => {
    writes.check(req.user!.id);
    res.json(await service!.patch(req.user!.id, req.body));
  }));
  router.delete("/", requireTrustedOrigin(config), asyncHandler(async (req, res) => {
    writes.check(req.user!.id);
    res.json(await service!.reset(req.user!.id));
  }));
  return router;
}
