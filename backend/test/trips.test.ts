import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthService } from "../src/auth/service.js";
import { loadConfig } from "../src/config.js";
import type { RecommendResponse, TripHistoryEntry } from "../src/contract/api.js";
import { createSupabaseTripHistoryStore, type TripHistoryStore } from "../src/db/trips.js";
import { defaultUserPreferences } from "../src/domain/preferences.js";
import { AppError } from "../src/errors.js";
import { PreferencesService } from "../src/services/preferences.js";
import { recommend } from "../src/services/recommend.js";
import { TripHistoryService } from "../src/services/trips.js";
import { makeContext } from "./fakes.js";

vi.mock("../src/services/recommend.js", () => ({ recommend: vi.fn() }));
const alice = "e9e8fa23-0fe6-4946-9cae-8fdd7beee750";
const bob = "1962947f-e780-4a0a-b6c9-0e201cad626d";
const tripId = "996b73e2-b094-4ab1-a283-ab4b894517f0";
const timestamp = "2026-10-30T06:00:00.000Z";
const entry = (id = tripId): TripHistoryEntry => ({
  id, sourceLabel: "Kandivali West", destinationLabel: "Borivali East", createdAt: timestamp,
  departureTime: timestamp, preferences: defaultUserPreferences(), resultCount: 0,
});
function fixture() {
  const rows = new Map<string, TripHistoryEntry[]>();
  const seen = new Set<string>();
  const store: TripHistoryStore = {
    list: vi.fn(async (userId, before, limit) => (rows.get(userId) ?? [])
      .filter(trip => !before || trip.createdAt < before.at || trip.createdAt === before.at && trip.id < before.id).slice(0, limit)),
    record: vi.fn(async (userId, trip) => {
      if (seen.has(`${userId}:${trip.requestId}`)) return;
      seen.add(`${userId}:${trip.requestId}`);
      rows.set(userId, [{ ...entry(), ...trip, createdAt: timestamp }, ...(rows.get(userId) ?? [])]);
    }),
    remove: vi.fn(async (userId, id) => { rows.set(userId, (rows.get(userId) ?? []).filter(trip => trip.id !== id)); }),
    clear: vi.fn(async userId => { rows.delete(userId); }),
  };
  return { rows, store, service: new TripHistoryService(store) };
}

describe("history paging", () => {
  it("pages tied timestamps without sharing records or trusting client ownership", async () => {
    const f = fixture();
    const ids = ["996b73e2-b094-4ab1-a283-ab4b894517f3", "996b73e2-b094-4ab1-a283-ab4b894517f2", tripId];
    f.rows.set(alice, ids.map(id => entry(id)));
    const first = await f.service.list(alice, { limit: "2" });
    expect(first.trips.map(trip => trip.id)).toEqual(ids.slice(0, 2));
    expect((await f.service.list(alice, { limit: "2", cursor: first.nextCursor })).trips.map(trip => trip.id)).toEqual([tripId]);
    expect(await f.service.list(bob, {})).toEqual({ trips: [], nextCursor: null });
    expect(f.store.list).toHaveBeenCalledWith(alice, { at: timestamp, id: ids[1] }, 3);
  });
  it("rejects malformed cursors, excessive page sizes and ownership fields before storage", async () => {
    const f = fixture();
    for (const query of [{ limit: 0 }, { limit: 51 }, { cursor: "not-json" }, { cursor: "../../elsewhere" }, { userId: alice },
      { cursor: Buffer.from(JSON.stringify({ at: timestamp, id: "x),user_id.eq.fake" })).toString("base64url") }]) {
      await expect(f.service.list(alice, query)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(f.service.remove(alice, "bad-id")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.store.list).not.toHaveBeenCalled(); expect(f.store.remove).not.toHaveBeenCalled();
  });
});

describe("Supabase history adapter (mocked HTTP)", () => {
  const config = loadConfig({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only-key" });
  const row = { id: tripId, user_id: alice, source_label: "Kandivali West", destination_label: "Borivali East",
    created_at: timestamp, departure_time: timestamp, preferences: defaultUserPreferences(), result_count: 0 };
  it("scopes reads and both deletes to the authenticated owner and persists only summary fields", async () => {
    const requests: Array<{ url: URL; method: string; body: unknown; headers: Headers }> = [];
    const store = createSupabaseTripHistoryStore(config, (async (input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ url: new URL(String(input)), method, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
      return method === "GET" ? Response.json([row]) : new Response(null, { status: 204 });
    }) as typeof fetch);
    expect(await store.list(alice, { at: timestamp, id: tripId }, 21)).toEqual([entry()]);
    await store.record(alice, { requestId: "history-request-1", sourceLabel: row.source_label, destinationLabel: row.destination_label,
      departureTime: timestamp, preferences: defaultUserPreferences(), resultCount: 0 });
    await store.remove(alice, tripId); await store.clear(alice);
    for (const i of [0, 2, 3]) expect(requests[i]!.url.searchParams.get("user_id")).toBe(`eq.${alice}`);
    expect(requests[0]!.url.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(requests[0]!.url.searchParams.get("or")).toContain(`id.lt.${tripId}`);
    expect(requests[2]!.url.searchParams.get("id")).toBe(`eq.${tripId}`);
    expect(requests[1]!.headers.get("prefer")).toContain("resolution=ignore-duplicates");
    expect(Object.keys(requests[1]!.body as object).sort()).toEqual(["user_id", "request_id", "source_label", "destination_label", "departure_time", "preferences", "result_count"].sort());
    expect(requests.every(request => request.headers.get("apikey") === "test-only-key")).toBe(true);
  });
  it("rejects unexpected owners and hides migration errors", async () => {
    const foreign = createSupabaseTripHistoryStore(config, (async () => Response.json([{ ...row, user_id: bob }])) as typeof fetch);
    await expect(foreign.list(alice, null, 20)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const offline = createSupabaseTripHistoryStore(config, (async () => Response.json({ code: "PGRST205", message: "private database detail" }, { status: 404 })) as typeof fetch);
    await expect(offline.list(alice, null, 20)).rejects.toMatchObject({ message: expect.not.stringContaining("private") });
    await expect(offline.remove(alice, tripId)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});

describe("account history HTTP and recommendation recording", () => {
  let server: Server; let base: string; let f: ReturnType<typeof fixture>;
  const auth = { authenticate: async (token: string | null) => {
    if (!token || !["alice", "bob"].includes(token)) throw new AppError("UNAUTHENTICATED", "Sign in");
    return { id: token === "alice" ? alice : bob };
  } } as AuthService;
  const headers = (user = "alice") => ({ cookie: `waydine_session=${user}`, Origin: "http://localhost:5173", "Content-Type": "application/json" });
  const input = { source: [72.84, 19.2], destination: [72.85, 19.22], departure: { mode: "now" }, tripLabels: { source: "Kandivali West", destination: "Borivali East" } };
  const response: RecommendResponse = { requestId: "fixture", timeZone: "Asia/Kolkata",
    route: { index: 0, geometry: [[72.84, 19.2], [72.85, 19.22]], durationSec: 600, distanceM: 3000, summary: "", departureTime: timestamp, arrivalTime: timestamp, alternatives: [] },
    recommendations: [], excluded: [], diagnostics: { corridorHalfWidthM: 200, searchAreas: { total: 0, failed: 0, truncated: 0 }, discovered: { geoapify: 0, mapbox: 0, merged: 0, malformedDropped: 0 }, inCorridor: 0, screened: 0, verified: 0, notEvaluated: 0, excludedByStage: {}, providers: {}, stageMs: {}, warnings: [] }, attribution: [] };
  beforeEach(async () => {
    vi.mocked(recommend).mockReset().mockResolvedValue(response);
    f = fixture();
    const ctx = makeContext({ places: [], requests: [] });
    ctx.googlePlacesEnabled = true; ctx.googlePlacesKey = "mock-key";
    const prefs = new PreferencesService({ find: async () => ({ preferences: { ...defaultUserPreferences(), diet: "vegetarian-options" }, updatedAt: timestamp }), patch: vi.fn(), reset: vi.fn() });
    server = createApp(loadConfig({}), ctx, { enabled: false, record() {} }, auth, prefs, f.service).listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const post = (body = input, extra = {}) => fetch(`${base}/api/google/recommend`, { method: "POST", headers: { ...headers(), ...extra }, body: JSON.stringify(body) });

  it("records successful zero-result searches with effective preferences and account ownership", async () => {
    const result = await post({ ...input, preferences: { budgetPerPersonInr: 450 } } as typeof input);
    expect(result.status).toBe(200); expect((await result.json()).history).toEqual({ saved: true });
    expect(f.store.record).toHaveBeenCalledWith(alice, expect.objectContaining({ sourceLabel: "Kandivali West", destinationLabel: "Borivali East", resultCount: 0,
      preferences: expect.objectContaining({ diet: "vegetarian-options", budgetPerPersonInr: 450 }) }));
    const list = await fetch(`${base}/api/me/trips`, { headers: headers() });
    expect(list.headers.get("cache-control")).toBe("no-store"); expect((await list.json()).trips).toHaveLength(1);
    expect((await (await fetch(`${base}/api/me/trips`, { headers: headers("bob") })).json()).trips).toEqual([]);
    expect(recommend).toHaveBeenCalledTimes(1);
  });
  it("does not fail useful results when history storage is unavailable", async () => {
    vi.mocked(f.store.record).mockRejectedValueOnce(new Error("database unavailable"));
    const result = await post();
    expect(result.status).toBe(200); expect((await result.json()).history).toEqual({ saved: false });
  });
  it("never saves failed recommendations", async () => {
    vi.mocked(recommend).mockRejectedValueOnce(new AppError("NO_ROUTE", "No route"));
    expect((await post()).status).not.toBe(200);
    expect(f.store.record).not.toHaveBeenCalled();
  });
  it("rejects malformed labels and forged owners before making a recommendation", async () => {
    const result = await post({ ...input, tripLabels: { source: "", destination: "B" }, userId: bob } as typeof input);
    expect(result.status).toBe(400); expect(recommend).not.toHaveBeenCalled(); expect(f.store.record).not.toHaveBeenCalled();
  });
  it("deduplicates the same request without allowing another user to delete it", async () => {
    await post(input, { "x-request-id": "same-history-request" });
    await post(input, { "x-request-id": "same-history-request" });
    expect(f.rows.get(alice)).toHaveLength(1);
    expect((await fetch(`${base}/api/me/trips/${tripId}`, { method: "DELETE", headers: headers("bob") })).status).toBe(204);
    expect(f.rows.get(alice)).toHaveLength(1);
    expect((await fetch(`${base}/api/me/trips`, { method: "DELETE", headers: headers() })).status).toBe(204);
    expect(f.rows.has(alice)).toBe(false);
  });
  it("authenticates every history read/delete, rejects CSRF and never calls providers", async () => {
    for (const [path, method] of [["/api/me/trips", "GET"], ["/api/me/trips", "DELETE"], [`/api/me/trips/${tripId}`, "DELETE"]]) {
      expect((await fetch(base + path, { method })).status).toBe(401);
    }
    expect((await fetch(`${base}/api/me/trips`, { method: "DELETE", headers: { cookie: headers().cookie, Origin: "https://hostile.example" } })).status).toBe(403);
    expect((await fetch(`${base}/api/me/trips`, { method: "DELETE", headers: { cookie: headers().cookie } })).status).toBe(403);
    expect(recommend).not.toHaveBeenCalled(); expect(f.store.clear).not.toHaveBeenCalled();
  });
});
