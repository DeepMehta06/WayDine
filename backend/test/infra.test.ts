import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { SharedRun, TtlCache } from "../src/lib/cache.js";
import { fetchJson } from "../src/lib/http.js";
import { ClientRateLimiter, istDayKey, QuotaManager } from "../src/lib/quota.js";
import { GENEROUS_LIMITS } from "./fakes.js";

const tmp = mkdtempSync(join(tmpdir(), "waydine-quota-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const schema = z.object({ ok: z.literal(true) });
const quota = () => new QuotaManager(GENEROUS_LIMITS, null);

describe("#63 provider deadlines, retries and cancellation", () => {
  it("times out a stalled call as UPSTREAM_TIMEOUT", async () => {
    const stall = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))))) as typeof fetch;
    await expect(
      fetchJson({ url: "https://x.test/a", schema, provider: "t", quota: quota(), budget: { bucket: "mapbox_directions", units: 1 }, timeoutMs: 20, retries: 0, fetchImpl: stall })
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });

  it("retries transient 503s, then succeeds, charging the budget per attempt", async () => {
    let calls = 0;
    const flaky = (async () => (++calls < 3 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify({ ok: true })))) as typeof fetch;
    const q = quota();
    const r = await fetchJson({ url: "https://x.test/b", schema, provider: "t", quota: q, budget: { bucket: "mapbox_directions", units: 1 }, fetchImpl: flaky, sleep: async () => undefined });
    expect(r).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(q.snapshot().buckets.mapbox_directions.used).toBe(3);
  });

  it("does not retry a non-transient 4xx", async () => {
    let calls = 0;
    const bad = (async () => {
      calls++;
      return new Response("secret upstream detail", { status: 401 });
    }) as typeof fetch;
    const err = await fetchJson({ url: "https://x.test/c", schema, provider: "t", quota: quota(), budget: { bucket: "mapbox_directions", units: 1 }, fetchImpl: bad }).catch((e) => e);
    expect(calls).toBe(1);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.message).not.toMatch(/secret upstream detail/);
  });

  it("reports caller cancellation as CANCELLED", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchJson({ url: "https://x.test/d", schema, provider: "t", quota: quota(), budget: { bucket: "mapbox_directions", units: 1 }, signal: controller.signal })
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("#67 runtime validation of provider responses", () => {
  it("rejects a response with the wrong shape without leaking it", async () => {
    const wrong = (async () => new Response(JSON.stringify({ unexpected: "payload" }))) as typeof fetch;
    const err = await fetchJson({ url: "https://x.test/e", schema, provider: "t", quota: quota(), budget: { bucket: "mapbox_directions", units: 1 }, fetchImpl: wrong }).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.message).not.toMatch(/payload/);
  });

  it("rejects malformed JSON", async () => {
    const garbage = (async () => new Response("<html>")) as typeof fetch;
    await expect(
      fetchJson({ url: "https://x.test/f", schema, provider: "t", quota: quota(), budget: { bucket: "mapbox_directions", units: 1 }, fetchImpl: garbage })
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});

describe("#62 hard free-tier ceilings", () => {
  it("allows explicit null or none request limits and rejects invalid values", () => {
    const c = loadConfig({ GOOGLE_PLACES_NEARBY_PER_DAY: "none", GOOGLE_PLACES_DETAILS_PER_DAY: "none" });
    expect(c.GOOGLE_PLACES_NEARBY_PER_DAY).toBeNull();
    expect(c.GOOGLE_PLACES_DETAILS_PER_DAY).toBeNull();
    expect(c.GOOGLE_PLACES_NEARBY_PER_MONTH).toBe(100);
    expect(loadConfig({}).GOOGLE_PLACES_NEARBY_PER_DAY).toBe(20);
    expect(loadConfig({ GOOGLE_PLACES_DETAILS_PER_DAY: "42" }).GOOGLE_PLACES_DETAILS_PER_DAY).toBe(42);
    const keys = ["GOOGLE_PLACES_NEARBY_PER_DAY", "GOOGLE_PLACES_DETAILS_PER_DAY",
      "GOOGLE_PLACES_NEARBY_PER_MONTH", "GOOGLE_PLACES_DETAILS_PER_MONTH",
      "GOOGLE_ROUTES_PER_DAY", "GOOGLE_ROUTE_MATRIX_ELEMENTS_PER_DAY", "GOOGLE_RECOMMEND_PER_MINUTE"] as const;
    for (const key of keys) {
      for (const value of ["null", "none"]) expect(loadConfig({ [key]: value })[key]).toBeNull();
      expect(loadConfig({ [key]: "42" })[key]).toBe(42);
      for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "unlimited"]) {
        expect(() => loadConfig({ [key]: value })).toThrow("Invalid backend configuration");
      }
    }
  });

  it("tracks unlimited usage across restarts and enforces a re-enabled ceiling", () => {
    const file = join(tmp, "unlimited.json");
    const now = () => new Date("2026-10-30T10:00:00+05:30");
    const q = new QuotaManager({ google_places_nearby: null }, file, now);
    q.reserve("google_places_nearby", 21);
    expect(q.remaining("google_places_nearby")).toBe(Infinity);
    expect(JSON.parse(JSON.stringify(q.snapshot())).buckets.google_places_nearby).toEqual({ used: 21, limit: null });
    expect(() => q.reserve("google_places_details", 1)).toThrow(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
    q.persistNow();
    const restored = new QuotaManager({ google_places_nearby: 22 }, file, now);
    expect(restored.remaining("google_places_nearby")).toBe(1);
    restored.reserve("google_places_nearby", 1);
    expect(() => restored.reserve("google_places_nearby", 1)).toThrow(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
  });

  it("permits more than 20 mocked calls with no daily cap but still enforces the monthly cap", async () => {
    for (const bucket of ["google_places_nearby", "google_places_details"] as const) {
      const daily = new QuotaManager({ [bucket]: null }, null);
      const monthly = new QuotaManager({ [bucket]: 21 }, null, undefined, "month");
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(JSON.stringify({ ok: true }));
      }) as typeof fetch;
      const request = () => fetchJson({ url: "https://x.test/unlimited", schema, provider: "mock", quota: daily,
        budget: { bucket, units: 1 }, additionalBudget: { quota: monthly, bucket, units: 1 }, fetchImpl, retries: 0 });
      for (let i = 0; i < 21; i++) await request();
      await expect(request()).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
      expect(calls).toBe(21);
      expect(daily.snapshot().buckets[bucket].used).toBe(21);
      expect(monthly.snapshot().buckets[bucket].used).toBe(21);
    }
  });

  it("allows more than 100 mocked calls with both daily and monthly caps disabled", async () => {
    for (const bucket of ["google_places_nearby", "google_places_details"] as const) {
      const daily = new QuotaManager({ [bucket]: null }, null);
      const monthly = new QuotaManager({ [bucket]: null }, null, undefined, "month");
      let calls = 0;
      const fetchImpl = (async () => {
        calls++;
        return new Response(JSON.stringify({ ok: true }));
      }) as typeof fetch;
      for (let i = 0; i < 101; i++) {
        await fetchJson({ url: "https://x.test/unlimited-month", schema, provider: "mock", quota: daily,
          budget: { bucket, units: 1 }, additionalBudget: { quota: monthly, bucket, units: 1 }, fetchImpl, retries: 0 });
      }
      expect(calls).toBe(101);
      expect(daily.snapshot().buckets[bucket]).toEqual({ used: 101, limit: null });
      expect(monthly.snapshot().buckets[bucket]).toEqual({ used: 101, limit: null });
    }
  });

  it("refuses work beyond the daily budget with a retry hint", () => {
    const q = new QuotaManager({ ...GENEROUS_LIMITS, geoapify_credits: 2 }, null);
    q.reserve("geoapify_credits", 2);
    try {
      q.reserve("geoapify_credits", 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "QUOTA_EXCEEDED" });
      expect((e as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("persists usage across restarts so a restart cannot reset the ceiling", () => {
    const file = join(tmp, "quota.json");
    const now = () => new Date("2026-10-29T10:00:00+05:30");
    const a = new QuotaManager(GENEROUS_LIMITS, file, now);
    a.reserve("mapbox_directions", 7);
    a.persistNow();
    const b = new QuotaManager(GENEROUS_LIMITS, file, now);
    expect(b.snapshot().buckets.mapbox_directions.used).toBe(7);
  });

  it("resets at Asia/Kolkata midnight, not UTC midnight", () => {
    expect(istDayKey(new Date("2026-10-29T18:29:00Z"))).toBe("2026-10-29");
    expect(istDayKey(new Date("2026-10-29T18:31:00Z"))).toBe("2026-10-30");
  });

  it("rate-limits a single client", () => {
    let t = 0;
    const limiter = new ClientRateLimiter(2, () => t);
    limiter.check("ip");
    limiter.check("ip");
    expect(() => limiter.check("ip")).toThrow(expect.objectContaining({ code: "RATE_LIMITED" }));
    limiter.check("other-ip");
    t = 61_000;
    expect(() => limiter.check("ip")).not.toThrow();
  });
});

describe("#64 caching and in-flight sharing", () => {
  it("expires cache entries", () => {
    let t = 0;
    const c = new TtlCache<string>(1000, 10, () => t);
    c.set("k", "v");
    expect(c.get("k")).toBe("v");
    t = 1001;
    expect(c.get("k")).toBeUndefined();
  });

  it("runs identical concurrent work once and only aborts when every caller leaves", async () => {
    const shared = new SharedRun<string>();
    let runs = 0;
    let taskSignal: AbortSignal | undefined;
    let release!: (v: string) => void;
    const task = (signal: AbortSignal) => {
      runs++;
      taskSignal = signal;
      return new Promise<string>((r) => (release = r));
    };
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = shared.run("k", c1.signal, task).catch((e) => `rejected:${String(e)}`);
    const p2 = shared.run("k", c2.signal, task);
    c1.abort();
    expect(taskSignal!.aborted).toBe(false);
    release("done");
    expect(await p2).toBe("done");
    expect(String(await p1)).toMatch(/rejected/);
    expect(runs).toBe(1);
  });
});
