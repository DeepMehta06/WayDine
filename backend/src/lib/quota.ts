/**
 * Hard free-tier ceilings. Provider usage is reserved *before* each upstream
 * call (failed calls still count) against per-day budgets keyed by the
 * Asia/Kolkata date, and persisted to disk so a restart cannot reset them.
 * Single-process only: a multi-instance deployment needs a shared store.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AppError } from "../errors.js";
import { log } from "./log.js";

export type BudgetBucket =
  | "geoapify_credits"
  | "mapbox_geocode"
  | "mapbox_searchbox"
  | "mapbox_directions"
  | "mapbox_matrix_elements";

interface PersistedState {
  day: string;
  used: Partial<Record<BudgetBucket, number>>;
}

export function istDayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export class QuotaManager {
  private state: PersistedState;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly limits: Record<BudgetBucket, number>,
    private readonly stateFile: string | null,
    private readonly now: () => Date = () => new Date()
  ) {
    this.state = this.load();
  }

  private load(): PersistedState {
    const fresh: PersistedState = { day: istDayKey(this.now()), used: {} };
    if (!this.stateFile) return fresh;
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as PersistedState;
      if (parsed && typeof parsed.day === "string" && parsed.used && typeof parsed.used === "object") {
        return parsed.day === fresh.day ? parsed : fresh;
      }
    } catch {
      // Missing or unreadable state starts a fresh day; never fail startup over it.
    }
    return fresh;
  }

  private rollover(): void {
    const today = istDayKey(this.now());
    if (this.state.day !== today) this.state = { day: today, used: {} };
  }

  private schedulePersist(): void {
    if (!this.stateFile || this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistNow();
    }, 250);
    this.writeTimer.unref?.();
  }

  persistNow(): void {
    if (!this.stateFile) return;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.stateFile);
    } catch (err) {
      log("error", "quota.persist_failed", { message: (err as Error).message });
    }
  }

  remaining(bucket: BudgetBucket): number {
    this.rollover();
    return Math.max(0, this.limits[bucket] - (this.state.used[bucket] ?? 0));
  }

  canAfford(bucket: BudgetBucket, units: number): boolean {
    return this.remaining(bucket) >= units;
  }

  /** Reserves usage or throws QUOTA_EXCEEDED. */
  reserve(bucket: BudgetBucket, units: number): void {
    this.rollover();
    if (!this.canAfford(bucket, units)) {
      throw new AppError(
        "QUOTA_EXCEEDED",
        "Today's free usage allowance for map data has been used up. Please try again tomorrow.",
        { retryAfterSec: secondsUntilIstMidnight(this.now()), diagnostic: `bucket=${bucket}` }
      );
    }
    this.state.used[bucket] = (this.state.used[bucket] ?? 0) + units;
    this.schedulePersist();
  }

  snapshot(): { day: string; buckets: Record<BudgetBucket, { used: number; limit: number }> } {
    this.rollover();
    const buckets = {} as Record<BudgetBucket, { used: number; limit: number }>;
    for (const key of Object.keys(this.limits) as BudgetBucket[]) {
      buckets[key] = { used: this.state.used[key] ?? 0, limit: this.limits[key] };
    }
    return { day: this.state.day, buckets };
  }
}

export function secondsUntilIstMidnight(now: Date): number {
  const istOffsetMs = 330 * 60 * 1000;
  const istMs = now.getTime() + istOffsetMs;
  const msIntoDay = ((istMs % 86_400_000) + 86_400_000) % 86_400_000;
  return Math.ceil((86_400_000 - msIntoDay) / 1000);
}

/** Sliding-window limiter per client key (IP) and route. In-memory, bounded size. */
export class ClientRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 10_000
  ) {}

  check(clientKey: string): void {
    const t = this.now();
    const windowStart = t - 60_000;
    const recent = (this.hits.get(clientKey) ?? []).filter((x) => x > windowStart);
    if (recent.length >= this.perMinute) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0]! + 60_000 - t) / 1000));
      throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
        retryAfterSec,
      });
    }
    recent.push(t);
    this.hits.delete(clientKey);
    this.hits.set(clientKey, recent);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
  }
}
