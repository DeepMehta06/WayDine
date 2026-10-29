/**
 * Structured application errors. User-facing messages never include upstream
 * response bodies; provider diagnostics stay in server logs.
 */
import type { ApiErrorBody, ApiErrorCode } from "./contract/api.js";

export type ErrorCode = ApiErrorCode;

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  OUT_OF_COVERAGE: 422,
  NO_ROUTE: 422,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNAVAILABLE: 502,
  NOT_CONFIGURED: 503,
  CANCELLED: 499,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly details?: unknown;
  /** Server-side only; never serialized to clients. */
  readonly diagnostic?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { retryAfterSec?: number; details?: unknown; diagnostic?: string; cause?: unknown } = {}
  ) {
    super(message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.retryAfterSec = opts.retryAfterSec;
    this.details = opts.details;
    this.diagnostic = opts.diagnostic;
  }
}

export function toErrorBody(err: unknown, requestId?: string): { status: number; body: ApiErrorBody } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          retryAfterSec: err.retryAfterSec,
          details: err.details,
          requestId,
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again.", requestId } },
  };
}
