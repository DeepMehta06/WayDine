import type { CookieOptions, Request, Response, RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import type { AuthUser } from "../contract/api.js";
import { AppError } from "../errors.js";
import type { AuthService } from "./service.js";

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export function cookieSettings(config: AppConfig) {
  const secure = config.AUTH_COOKIE_SECURE === "true";
  const prefix = secure ? "__Host-" : "";
  const options: CookieOptions = { httpOnly: true, secure, sameSite: "lax", path: "/" };
  return { session: `${prefix}waydine_session`, flow: `${prefix}waydine_oauth`, options };
}

/** Reject duplicate cookie names rather than trusting a shadowing/path-scoped cookie. */
export function readCookie(req: Request, name: string): string | null {
  const values = (req.headers.cookie ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try {
    const value = decodeURIComponent(values[0]!.slice(name.length + 1));
    return value.length <= 4000 ? value : null;
  } catch { return null; }
}

export function clearSession(res: Response, config: AppConfig): void {
  const cookies = cookieSettings(config);
  res.clearCookie(cookies.session, cookies.options);
}

/** Cookie-authenticated mutations require a known browser Origin (CSRF protection). */
export function requireTrustedOrigin(config: AppConfig): RequestHandler {
  const trusted = new Set([new URL(config.AUTH_FRONTEND_URL).origin, new URL(config.AUTH_CALLBACK_URL).origin]);
  return (req, _res, next) => next(req.headers.origin && trusted.has(req.headers.origin)
    ? undefined : new AppError("FORBIDDEN", "This request origin is not allowed."));
}

/** Reuse on future account-owned routes; identity is verified server-side on every request. */
export function requireAuth(service: AuthService | null, config: AppConfig): RequestHandler {
  return (req, res, next) => {
    if (!service) return next(new AppError("NOT_CONFIGURED", "Google sign-in is not configured on this server."));
    service.authenticate(readCookie(req, cookieSettings(config).session)).then((user) => {
      req.user = user;
      next();
    }).catch((err: unknown) => {
      if (err instanceof AppError && err.code === "UNAUTHENTICATED") clearSession(res, config);
      next(err);
    });
  };
}
