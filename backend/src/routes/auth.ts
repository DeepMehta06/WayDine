import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { AuthMeResponse } from "../contract/api.js";
import { cookieSettings, readCookie, requireAuth, requireTrustedOrigin, clearSession } from "../auth/http.js";
import { OAUTH_TTL_MS, type AuthService } from "../auth/service.js";
import { AppError } from "../errors.js";
import { asyncHandler, clientKey } from "../lib/express.js";
import { ClientRateLimiter } from "../lib/quota.js";

export function authRouter(config: AppConfig, service: AuthService | null): Router {
  const router = Router();
  const cookies = cookieSettings(config);
  const startLimiter = new ClientRateLimiter(10);
  const callbackLimiter = new ClientRateLimiter(20);
  const accountLimiter = new ClientRateLimiter(60);

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  router.get("/status", (_req, res) => { res.json({ enabled: Boolean(service), provider: "google" }); });
  router.use((_req, _res, next) => next(service ? undefined : new AppError("NOT_CONFIGURED", "Google sign-in is not configured on this server.")));

  router.get("/google", asyncHandler(async (req, res) => {
    startLimiter.check(clientKey(req));
    const { url, flowCookie } = await service!.begin();
    res.cookie(cookies.flow, flowCookie, { ...cookies.options, maxAge: OAUTH_TTL_MS });
    res.redirect(302, url);
  }));

  router.get("/callback", asyncHandler(async (req, res) => {
    // One active attempt per browser. Starting over invalidates the earlier attempt.
    const cookie = readCookie(req, cookies.flow);
    res.clearCookie(cookies.flow, cookies.options);
    callbackLimiter.check(clientKey(req));
    if (req.query.error !== undefined) throw new AppError("AUTH_FAILED", "Google sign-in was cancelled or denied. Please try again.");
    const code = z.string().min(1).max(2048).safeParse(req.query.code);
    if (!code.success) throw new AppError("BAD_REQUEST", "The sign-in callback is missing a valid authorization code.");
    const token = await service!.complete(code.data, cookie);
    // Only one WayDine session per browser cookie; don't retain the replaced session.
    try { await service!.logout(readCookie(req, cookies.session)); }
    catch { /* The previous session will expire; never discard a successful new login here. */ }
    res.cookie(cookies.session, token, { ...cookies.options, maxAge: config.AUTH_SESSION_DAYS * 86_400_000 });
    res.redirect(303, config.AUTH_FRONTEND_URL);
  }));

  router.get("/me", (req, _res, next) => {
    try { accountLimiter.check(clientKey(req)); next(); } catch (error) { next(error); }
  }, requireAuth(service, config), (req, res) => {
    const body: AuthMeResponse = { user: req.user! };
    res.json(body);
  });

  router.post("/logout", requireTrustedOrigin(config), asyncHandler(async (req, res) => {
    accountLimiter.check(clientKey(req));
    await service!.logout(readCookie(req, cookies.session));
    clearSession(res, config);
    res.clearCookie(cookies.flow, cookies.options);
    res.status(204).end();
  }));
  return router;
}
