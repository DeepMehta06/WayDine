/**
 * Bounded TTL cache plus in-flight request coalescing. Only used for sources
 * whose terms permit caching (Geoapify). Mapbox temporary results are never
 * stored here; they may only share a single in-flight promise.
 */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Coalesces identical concurrent work that is cancellable. The shared task is
 * aborted only when every caller waiting on it has cancelled.
 */
export class SharedRun<V> {
  private pending = new Map<string, { promise: Promise<V>; controller: AbortController; waiters: number }>();

  run(key: string, callerSignal: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<V>): Promise<V> {
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = task(controller.signal).finally(() => {
        if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
      });
      entry = { promise, controller, waiters: 0 };
      this.pending.set(key, entry);
    }
    const shared = entry;
    shared.waiters++;
    if (!callerSignal) return shared.promise;

    return new Promise<V>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        shared.waiters--;
        if (shared.waiters <= 0) shared.controller.abort();
        reject(callerSignal.reason ?? new Error("aborted"));
      };
      if (callerSignal.aborted) return onAbort();
      callerSignal.addEventListener("abort", onAbort, { once: true });
      shared.promise.then(
        (v) => {
          if (settled) return;
          settled = true;
          callerSignal.removeEventListener("abort", onAbort);
          resolve(v);
        },
        (e) => {
          if (settled) return;
          settled = true;
          callerSignal.removeEventListener("abort", onAbort);
          reject(e);
        }
      );
    });
  }
}

export class InFlight<V> {
  private pending = new Map<string, Promise<V>>();

  run(key: string, task: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const p = task().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
}
