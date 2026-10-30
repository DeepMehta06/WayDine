/**
 * Provider HTTP client: per-attempt deadline, caller cancellation, bounded
 * retries with backoff for transient failures, budget reservation per
 * attempt, and runtime validation of the response envelope.
 */
import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "../errors.js";
import { log, redactUrl } from "./log.js";
import type { BudgetBucket, QuotaManager } from "./quota.js";

export interface FetchJsonOptions<T> {
  url: string;
  schema: ZodType<T, ZodTypeDef, any>;
  provider: string;
  quota: QuotaManager;
  budget: { bucket: BudgetBucket; units: number };
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  logResponseBody?: boolean;
  additionalBudget?: { quota: QuotaManager; bucket: BudgetBucket; units: number };
  /** Maps a non-retryable HTTP status (with its body) to a domain error. */
  mapStatus?: (status: number, body: string) => AppError | undefined;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchJson<T>(opts: FetchJsonOptions<T>): Promise<T> {
  const {
    url,
    schema,
    provider,
    quota,
    budget,
    signal,
    timeoutMs = 8000,
    retries = 2,
    fetchImpl = fetch,
    sleep = defaultSleep,
    mapStatus,
  } = opts;

  let lastError: AppError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
    const additional = opts.additionalBudget;
    // Check both ceilings before reserving either, without yielding between checks.
    if (additional && !additional.quota.canAfford(additional.bucket, additional.units)) additional.quota.reserve(additional.bucket, additional.units);
    quota.reserve(budget.bucket, budget.units);
    if (additional) additional.quota.reserve(additional.bucket, additional.units);

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const started = Date.now();

    let res: Response;
    try {
      res = await fetchImpl(url, { signal: combined, method: opts.method ?? "GET", headers: { Accept: "application/json", ...opts.headers }, ...(opts.body !== undefined ? { body: opts.body } : {}) });
    } catch (err) {
      if (signal?.aborted) throw new AppError("CANCELLED", "Request was cancelled.");
      const timedOut = timeout.aborted;
      lastError = new AppError(
        timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        timedOut ? "A map data service took too long to respond." : "A map data service could not be reached.",
        { diagnostic: `${provider} ${redactUrl(url)} ${(err as Error).name}` }
      );
      log("warn", "provider.network_error", { provider, url: redactUrl(url), attempt, timedOut, ms: Date.now() - started });
      if (attempt < retries) await sleep(backoffMs(attempt));
      continue;
    }

    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => "")).slice(0, 300);
      log("warn", "provider.http_error", {
        provider,
        url: redactUrl(url),
        status: res.status,
        attempt,
        ms: Date.now() - started,
        ...(opts.logResponseBody === false ? {} : { body: bodySnippet }),
      });
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        lastError = new AppError("UPSTREAM_UNAVAILABLE", "A map data service is temporarily unavailable.", {
          diagnostic: `${provider} status=${res.status}`,
        });
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : backoffMs(attempt));
        continue;
      }
      const mapped = mapStatus?.(res.status, bodySnippet);
      if (mapped) throw mapped;
      if (res.status === 429) {
        throw new AppError("RATE_LIMITED", "A map data service is rate-limiting requests. Please try again shortly.", {
          retryAfterSec: 30,
          diagnostic: `${provider} status=429`,
        });
      }
      throw new AppError("UPSTREAM_UNAVAILABLE", "A map data service returned an error.", {
        diagnostic: `${provider} status=${res.status}`,
      });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new AppError("UPSTREAM_UNAVAILABLE", "A map data service returned an unreadable response.", {
        diagnostic: `${provider} malformed JSON`,
      });
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      log("warn", "provider.schema_mismatch", {
        provider,
        url: redactUrl(url),
        issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      throw new AppError("UPSTREAM_UNAVAILABLE", "A map data service returned data in an unexpected format.", {
        diagnostic: `${provider} schema mismatch`,
      });
    }
    log("info", "provider.ok", { provider, url: redactUrl(url), attempt, ms: Date.now() - started });
    return parsed.data;
  }

  throw lastError ?? new AppError("UPSTREAM_UNAVAILABLE", "A map data service could not be reached.");
}

function backoffMs(attempt: number): number {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 100);
}

/** Runs tasks with a concurrency limit, collecting per-task success or failure. */
export async function mapSettled<I, O>(
  items: I[],
  concurrency: number,
  task: (item: I, index: number) => Promise<O>
): Promise<Array<{ ok: true; value: O } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: O } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await task(items[i]!, i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
