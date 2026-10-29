import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
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
