import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthService } from "../src/auth/service.js";
import { loadConfig } from "../src/config.js";
import { createSupabasePreferencesStore, type PreferencesStore, type SavedUserPreferences } from "../src/db/preferences.js";
import { defaultUserPreferences } from "../src/domain/preferences.js";
import { AppError } from "../src/errors.js";
import { PreferencesService } from "../src/services/preferences.js";
import { makeContext } from "./fakes.js";

const alice = "e9e8fa23-0fe6-4946-9cae-8fdd7beee750";
const bob = "1962947f-e780-4a0a-b6c9-0e201cad626d";
const timestamp = "2026-10-30T06:00:00+00:00";

function fixtureStore() {
  const rows = new Map<string, SavedUserPreferences>();
  const store: PreferencesStore = {
    find: vi.fn(async (id) => rows.has(id) ? structuredClone(rows.get(id)!) : null),
    patch: vi.fn(async (id, patch) => {
      const row = { preferences: { ...(rows.get(id)?.preferences ?? defaultUserPreferences()), ...patch }, updatedAt: timestamp };
      rows.set(id, structuredClone(row)); return structuredClone(row);
    }),
    reset: vi.fn(async (id) => { rows.delete(id); }),
  };
  return { rows, store, service: new PreferencesService(store) };
}

describe("saved preference behavior", () => {
  it("returns unsaved defaults without creating a record or sharing mutable defaults", async () => {
    const f = fixtureStore(); const first = await f.service.get(alice);
    expect(first).toEqual({ preferences: { diet: "any", cuisines: [], includeUnconfirmedDiet: false, maxDetourMinutes: 10, budgetPerPersonInr: null }, saved: false, updatedAt: null });
    expect(f.rows.size).toBe(0); expect(f.store.patch).not.toHaveBeenCalled();
    first.preferences.cuisines.push("pizza");
    expect((await f.service.get(alice)).preferences.cuisines).toEqual([]);
  });
  it("saves partial changes, preserves other fields and reads across service instances", async () => {
    const f = fixtureStore();
    await f.service.patch(alice, { diet: "vegetarian-options", cuisines: ["south indian"], budgetPerPersonInr: 350 });
    const changed = await f.service.patch(alice, { maxDetourMinutes: 5 });
    expect(changed).toMatchObject({ saved: true, updatedAt: timestamp, preferences: { diet: "vegetarian-options", cuisines: ["south indian"], maxDetourMinutes: 5, budgetPerPersonInr: 350 } });
    expect(await new PreferencesService(f.store).get(alice)).toEqual(changed);
  });
  it("keeps separate users isolated and accepts explicit false, empty lists and a null budget", async () => {
    const f = fixtureStore();
    await f.service.patch(alice, { diet: "pure-veg", cuisines: ["pizza"], includeUnconfirmedDiet: true, budgetPerPersonInr: 500 });
    await f.service.patch(bob, { diet: "any", budgetPerPersonInr: 200 });
    await f.service.patch(alice, { cuisines: [], includeUnconfirmedDiet: false, budgetPerPersonInr: null });
    expect((await f.service.get(alice)).preferences).toMatchObject({ diet: "pure-veg", cuisines: [], includeUnconfirmedDiet: false, budgetPerPersonInr: null });
    expect((await f.service.get(bob)).preferences).toMatchObject({ diet: "any", budgetPerPersonInr: 200 });
  });
  it("deduplicates supported cuisines without changing the user's order", async () => {
    const f = fixtureStore();
    expect((await f.service.patch(alice, { cuisines: ["pizza", "chinese", "pizza"] })).preferences.cuisines).toEqual(["pizza", "chinese"]);
  });
  it("rejects malformed, out-of-range and ownership/privilege fields before writing", async () => {
    const f = fixtureStore();
    for (const body of [null, [], {}, { diet: "vegan" }, { diet: null }, { cuisines: "pizza" }, { cuisines: ["moon cheese"] },
      { maxDetourMinutes: 0 }, { maxDetourMinutes: 61 }, { maxDetourMinutes: 5.5 }, { maxDetourMinutes: "5" },
      { budgetPerPersonInr: 0 }, { budgetPerPersonInr: -1 }, { budgetPerPersonInr: 100001 }, { budgetPerPersonInr: 200.5 },
      { includeUnconfirmedDiet: "false" }, { userId: bob, diet: "any" }, { role: "admin" }, { preferences: { diet: "any" } }]) {
      await expect(f.service.patch(alice, body)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(f.store.patch).not.toHaveBeenCalled();
  });
  it("resets only the owner's preferences and supports repeated resets", async () => {
    const f = fixtureStore(); await f.service.patch(alice, { diet: "pure-veg" }); await f.service.patch(bob, { budgetPerPersonInr: 250 });
    expect(await f.service.reset(alice)).toEqual({ preferences: defaultUserPreferences(), saved: false, updatedAt: null });
    expect(await f.service.reset(alice)).toMatchObject({ saved: false });
    expect((await f.service.get(bob)).preferences.budgetPerPersonInr).toBe(250);
  });
  it("propagates storage outages instead of silently reporting default or saved values", async () => {
    const f = fixtureStore(); const unavailable = new AppError("UPSTREAM_UNAVAILABLE", "storage offline");
    vi.mocked(f.store.find).mockRejectedValueOnce(unavailable);
    vi.mocked(f.store.patch).mockRejectedValueOnce(unavailable);
    vi.mocked(f.store.reset).mockRejectedValueOnce(unavailable);
    await expect(f.service.get(alice)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await expect(f.service.patch(alice, { diet: "any" })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await expect(f.service.reset(alice)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});

describe("Supabase preferences adapter (mocked HTTP)", () => {
  const config = loadConfig({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-only" });
  const row = { user_id: alice, diet: "vegetarian-options", cuisines: ["pizza"], include_unconfirmed_diet: false,
    max_detour_minutes: 10, budget_per_person_inr: 300, updated_at: timestamp };
  it("filters reads/deletes by verified user ID and sends only partial fields to the atomic RPC", async () => {
    const requests: Array<{ url: URL; method: string; body: unknown; headers: Headers }> = [];
    const store = createSupabasePreferencesStore(config, (async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
      return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(method === "GET" ? [row] : row);
    }) as typeof fetch);
    expect((await store.find(alice))!.preferences.budgetPerPersonInr).toBe(300);
    await store.patch(alice, { budgetPerPersonInr: null }); await store.reset(alice);
    expect(requests[0]!.url.searchParams.get("user_id")).toBe(`eq.${alice}`);
    expect(requests[1]).toMatchObject({ method: "POST", body: { p_user_id: alice, p_patch: { budgetPerPersonInr: null } } });
    expect(requests[1]!.url.pathname).toBe("/rest/v1/rpc/waydine_patch_preferences");
    expect(requests[2]!.url.searchParams.get("user_id")).toBe(`eq.${alice}`);
    expect(requests.every((r) => r.headers.get("apikey") === "test-service-only")).toBe(true);
  });
  it("treats no saved row as absent rather than an error", async () => {
    const store = createSupabasePreferencesStore(config, (async () => Response.json([])) as typeof fetch);
    expect(await store.find(alice)).toBeNull();
  });
  it("rejects mismatched owners and invalid stored data", async () => {
    for (const invalid of [{ ...row, user_id: bob }, { ...row, budget_per_person_inr: -1 }, { ...row, diet: "unknown" }]) {
      const store = createSupabasePreferencesStore(config, (async () => Response.json([invalid])) as typeof fetch);
      await expect(store.find(alice)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    }
  });
  it("hides missing-migration/provider details in structured errors", async () => {
    const store = createSupabasePreferencesStore(config, (async () => Response.json({ message: "sensitive database detail", code: "PGRST205" }, { status: 404 })) as typeof fetch);
    await expect(store.find(alice)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", message: expect.not.stringContaining("sensitive") });
    await expect(store.patch(alice, { diet: "any" })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await expect(store.reset(alice)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});

describe("preferences HTTP API", () => {
  let server: Server; let base: string; const f = fixtureStore();
  const auth = { authenticate: async (token: string | null) => {
    if (token !== "alice-session" && token !== "bob-session") throw new AppError("UNAUTHENTICATED", "Sign in");
    return { id: token === "alice-session" ? alice : bob };
  } } as AuthService;
  beforeAll(async () => {
    server = createApp(loadConfig({}), makeContext({ places: [], requests: [] }), { enabled: false, record() {} }, auth, f.service).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/preferences`;
  });
  afterAll(() => server.close());
  const headers = (who = "alice") => ({ cookie: `waydine_session=${who}-session`, Origin: "http://localhost:5173", "Content-Type": "application/json" });
  const patch = (body: unknown, who = "alice") => fetch(base, { method: "PATCH", headers: headers(who), body: JSON.stringify(body) });

  it("requires authentication on every operation", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const r = await fetch(base, { method }); expect(r.status).toBe(401);
      expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
    }
  });
  it("returns defaults with no-store headers before the first save", async () => {
    const r = await fetch(base, { headers: headers() });
    expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ preferences: defaultUserPreferences(), saved: false, updatedAt: null });
  });
  it("saves and reads the authenticated user's preferences without accepting an owner from the client", async () => {
    const r = await patch({ diet: "pure-veg", maxDetourMinutes: 5, budgetPerPersonInr: 400 });
    expect(r.status).toBe(200);
    expect((await r.json()).preferences).toMatchObject({ diet: "pure-veg", maxDetourMinutes: 5, budgetPerPersonInr: 400 });
    expect((await patch({ diet: "any", userId: bob })).status).toBe(400);
    const other = await fetch(`${base}?userId=${alice}`, { headers: headers("bob") });
    expect((await other.json()).saved).toBe(false);
    expect((await (await fetch(base, { headers: headers() })).json()).preferences.diet).toBe("pure-veg");
  });
  it("rejects hostile or missing Origin on mutations", async () => {
    const wrong = { ...headers(), Origin: "https://untrusted.example" };
    expect((await fetch(base, { method: "PATCH", headers: wrong, body: JSON.stringify({ diet: "any" }) })).status).toBe(403);
    expect((await fetch(base, { method: "DELETE", headers: { cookie: headers().cookie } })).status).toBe(403);
    expect((await fetch(base, { method: "DELETE", headers: wrong })).status).toBe(403);
  });
  it("returns structured validation errors without changing saved values", async () => {
    const r = await patch({ maxDetourMinutes: 500 });
    expect(r.status).toBe(400);
    expect((await r.json()).error.details.fieldErrors.maxDetourMinutes).toBeDefined();
    expect((await f.service.get(alice)).preferences.maxDetourMinutes).toBe(5);
  });
  it("reset affects only the requesting user", async () => {
    expect((await patch({ budgetPerPersonInr: 200 }, "bob")).status).toBe(200);
    const r = await fetch(base, { method: "DELETE", headers: headers() });
    expect(r.status).toBe(200); expect((await r.json()).saved).toBe(false);
    expect((await f.service.get(bob)).preferences.budgetPerPersonInr).toBe(200);
  });
});
