import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSearchLogger } from "../src/db/searchLog.js";
import { eastOf, makeContext } from "./fakes.js";

let server: Server;
let base: string;

beforeAll(async () => {
  // #59: no Supabase credentials at all, and logging not requested.
  const config = loadConfig({ CORS_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv);
  const ctx = makeContext({ places: [{ id: "m", name: "Test Dhaba", provider: "mapbox", at: eastOf([72.84, 19.2], 2000) }], requests: [] });
  const app = createApp(config, ctx, await createSearchLogger(config));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const post = (body: unknown) =>
  fetch(`${base}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const valid = {
  source: [72.84, 19.2],
  destination: eastOf([72.84, 19.2], 6000),
  departure: { mode: "now" },
  preferences: { diet: "any", includeUnconfirmedDiet: false, maxDetourMinutes: 15, cuisines: [] },
};

describe("#59 optional logging", () => {
  it("starts and serves without Supabase configuration", async () => {
    const r = await fetch(`${base}/api/health`);
    expect(await r.json()).toEqual({ status: "ok" });
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.capabilities.searchLogging).toBe(false);
  });
});

describe("#60 legacy database endpoint is gone", () => {
  it("returns a structured 400 for /api/restaurants", async () => {
    const r = await fetch(`${base}/api/restaurants`);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("#65/#66 structured, semantic validation errors", () => {
  it("rejects identical endpoints", async () => {
    const r = await post({ ...valid, destination: valid.source });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.details.fieldErrors.destination).toBeDefined();
    expect(body.error.requestId).toBeTruthy();
  });

  it("rejects trips outside India as OUT_OF_COVERAGE", async () => {
    const r = await post({ ...valid, source: [-0.12, 51.5] });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("OUT_OF_COVERAGE");
  });

  it("rejects a departure in the past", async () => {
    const r = await post({ ...valid, departure: { mode: "at", time: "2020-01-01T10:00:00+05:30" } });
    expect((await r.json()).error.details.fieldErrors.departure).toBeDefined();
  });

  it("rejects unsupported cuisines and extreme detours", async () => {
    const r = await post({ ...valid, preferences: { ...valid.preferences, cuisines: ["moon cheese"], maxDetourMinutes: 500 } });
    expect(r.status).toBe(400);
  });

  it("rejects malformed JSON with a structured error", async () => {
    const r = await fetch(`${base}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await r.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("end-to-end through HTTP with fake providers", () => {
  it("returns recommendations with a request id and attribution", async () => {
    const r = await post(valid);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.recommendations.map((x: { name: string }) => x.name)).toEqual(["Test Dhaba"]);
    expect(body.attribution).toEqual(expect.arrayContaining(["© OpenStreetMap contributors", "© Mapbox"]));
    expect(r.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("serves place suggestions", async () => {
    const r = await fetch(`${base}/api/places/suggest?q=Kandivali&near=72.87,19.07`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.providers).toEqual({ geoapify: "ok", mapbox: "ok" });
    // The Geoapify suburb and the Mapbox locality (alias spelling, ~600 m apart) collapse to one choice.
    expect(body.suggestions.map((s: { name: string }) => s.name)).toEqual(["Kandivali West"]);
  });
});
