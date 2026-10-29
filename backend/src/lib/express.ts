import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError, toErrorBody } from "../errors.js";
import { log } from "./log.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      /** Aborted when the client disconnects before the response is sent. */
      abortSignal: AbortSignal;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", req.id);

  const controller = new AbortController();
  req.abortSignal = controller.signal;
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  const started = Date.now();
  res.on("finish", () => {
    log("info", "http.request", {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
}

export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("BAD_REQUEST", "Unknown API endpoint."));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const isJsonSyntax = err instanceof SyntaxError && "body" in (err as object);
  const appErr = isJsonSyntax ? new AppError("BAD_REQUEST", "Request body is not valid JSON.") : err;
  const { status, body } = toErrorBody(appErr, req.id);

  if (appErr instanceof AppError) {
    if (appErr.code !== "CANCELLED") {
      log(status >= 500 ? "error" : "warn", "http.error", {
        requestId: req.id,
        code: appErr.code,
        diagnostic: appErr.diagnostic,
      });
    }
    if (appErr.retryAfterSec) res.setHeader("Retry-After", String(appErr.retryAfterSec));
  } else {
    log("error", "http.unhandled", { requestId: req.id, message: (err as Error)?.message, stack: (err as Error)?.stack });
  }
  if (res.headersSent || req.abortSignal?.aborted) return;
  res.status(status).json(body);
}
