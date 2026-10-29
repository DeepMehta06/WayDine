import { describe, expect, it } from "vitest";
import type { PlaceSuggestion } from "../src/contract/api.js";
import { toSuggestion } from "../src/providers/geoapify.js";
import { toGeocodeSuggestion } from "../src/providers/mapbox.js";
import { DEFAULT_BIAS, expandAliases, rankSuggestions, suggestPlaces } from "../src/services/places.js";
import { transliterateDevanagari } from "../src/domain/transliterate.js";
import { makeContext } from "./fakes.js";

const s = (name: string, kind: PlaceSuggestion["kind"], coordinates: [number, number], source: PlaceSuggestion["source"] = "mapbox"): PlaceSuggestion => ({
  id: `${source}:${name}:${coordinates.join(",")}`,
  name,
  secondary: null,
  kind,
  coordinates,
  source,
});

describe("#11 documented spelling aliases and East/West abbreviations", () => {
  it.each([
    ["Borivli", "Borivali"],
    ["Kandivli West", "Kandivali West"],
    ["Kandiwali", "Kandivali"],
    ["Borivali (E)", "Borivali East"],
    ["Kandivali W", "Kandivali West"],
    ["Andheri (west)", "Andheri West"],
    ["Borivali East", "Borivali East"],
  ])("%s -> %s", (input, expected) => {
    expect(expandAliases(input)).toBe(expected);
  });

  it("does not rewrite unrelated words containing the letters e/w", () => {
    expect(expandAliases("New Link Road")).toBe("New Link Road");
  });
});

describe("#03 contextual ranking", () => {
  it("ranks Andheri East in Mumbai above Andheri, Punjab (measured Geoapify failure)", () => {
    const ranked = rankSuggestions(
      [s("Andheri", "city", [75.813, 30.27], "geoapify"), s("Andheri East", "locality", [72.8537, 19.1173])],
      "Andheri East",
      DEFAULT_BIAS
    );
    expect(ranked[0]!.name).toBe("Andheri East");
  });

  it("puts the Kandivali West suburb ahead of shops named after it", () => {
    const ranked = rankSuggestions(
      [
        s("Domino's Pizza | Kandivali West, Mumbai", "poi", [72.838, 19.205]),
        s("Kandivali West", "suburb", [72.8399, 19.2055], "geoapify"),
      ],
      "Kandivali West",
      DEFAULT_BIAS
    );
    expect(ranked[0]!.name).toBe("Kandivali West");
  });

  it("keeps both Borivali East and Borivali West as distinct choices", () => {
    const ranked = rankSuggestions(
      [s("Borivali East", "locality", [72.8633, 19.2276]), s("Borivali West", "locality", [72.8479, 19.2285]), s("Borivali East", "suburb", [72.8639, 19.2276], "geoapify")],
      "Borivali",
      DEFAULT_BIAS
    );
    expect(ranked.map((r) => r.name)).toEqual(["Borivali East", "Borivali West"]);
  });
});

describe("#03 regressions observed against live providers (30 Oct 2026)", () => {
  it("ranks Mumbai's Borivali East/West above an exact-name village 40 km away (Khopoli)", () => {
    const ranked = rankSuggestions(
      [
        s("Borivali", "locality", [73.1902, 18.8764]),
        s("Borivali East", "suburb", [72.8619, 19.2267], "geoapify"),
        s("Borivali West", "locality", [72.8479, 19.2285]),
      ],
      "Borivali",
      DEFAULT_BIAS
    );
    expect(ranked.slice(0, 2).map((r) => r.name).sort()).toEqual(["Borivali East", "Borivali West"]);
  });

  it("does not let 'East Mankhurd' outrank Borivali East station results for 'Borivali East'", () => {
    const ranked = rankSuggestions(
      [
        s("Borivali East", "suburb", [72.8639, 19.2276], "geoapify"),
        s("East Mankhurd", "neighbourhood", [72.9547, 19.0562]),
        s("Borivali Station (East)", "poi", [72.8577, 19.2294], "geoapify"),
      ],
      "Borivali East",
      DEFAULT_BIAS
    );
    expect(ranked.map((r) => r.name)).toEqual(["Borivali East", "Borivali Station (East)", "East Mankhurd"]);
  });
});

describe("#11 Devanagari queries", () => {
  it.each([
    ["बोरीवली", "Borivali"],
    ["कांदिवली", "Kandivali"],
    ["अंधेरी", "Andheri"],
    ["बोरीवली पूर्व", "Borivali East"],
    ["कांदिवली पश्चिम", "Kandivali West"],
  ])("transliterates %s to %s", (input, expected) => {
    expect(transliterateDevanagari(input)).toBe(expected);
  });

  it("matches Latin results to a Devanagari query", () => {
    const ranked = rankSuggestions(
      [s("Barwala", "suburb", [77.06, 28.76], "geoapify"), s("Borivali East", "suburb", [72.8639, 19.2276], "geoapify")],
      "बोरीवली पूर्व",
      DEFAULT_BIAS
    );
    expect(ranked[0]!.name).toBe("Borivali East");
  });
});

describe("#02/#04 granular types and preserved names", () => {
  it("maps Geoapify suburbs with their name and city context", () => {
    const sug = toSuggestion({ name: "Kandivali West", result_type: "suburb", city: "Mumbai", state: "Maharashtra", lon: 72.84, lat: 19.2, place_id: "x" });
    expect(sug).toMatchObject({ name: "Kandivali West", kind: "suburb", secondary: "Mumbai, Maharashtra" });
  });

  it("maps Mapbox localities and neighbourhoods", () => {
    const loc = toGeocodeSuggestion({
      geometry: { coordinates: [72.8633, 19.2276] },
      properties: { mapbox_id: "m", feature_type: "locality", name: "Borivali East", place_formatted: "Mumbai, Mumbai Suburban, Maharashtra, India" },
    });
    expect(loc).toMatchObject({ name: "Borivali East", kind: "locality", secondary: "Mumbai, Mumbai Suburban, Maharashtra" });
    expect(toGeocodeSuggestion({ geometry: { coordinates: [1, 2] }, properties: { mapbox_id: "n", feature_type: "neighborhood", name: "Charkop" } })?.kind).toBe("neighbourhood");
  });

  it("drops malformed provider records instead of failing", () => {
    expect(toSuggestion({ name: "No coords" })).toBeNull();
    expect(toGeocodeSuggestion({ properties: {} })).toBeNull();
  });
});

describe("#08 provider failure is distinguishable from no results", () => {
  const geoOk = (url: URL) => url.hostname === "api.geoapify.com";

  it("returns partial results and per-provider status when one provider fails", async () => {
    const ctx = makeContext({ places: [], requests: [] });
    ctx.fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (geoOk(url)) return new Response(JSON.stringify({ results: [{ name: "Kandivali West", result_type: "suburb", lon: 72.84, lat: 19.2 }] }));
      return new Response("nope", { status: 503 });
    }) as typeof fetch;
    const r = await suggestPlaces(ctx, "Kandivali West", DEFAULT_BIAS);
    expect(r.partial).toBe(true);
    expect(r.providers).toEqual({ geoapify: "ok", mapbox: "error" });
    expect(r.suggestions[0]!.name).toBe("Kandivali West");
  });

  it("throws a structured error when every provider fails", async () => {
    const ctx = makeContext({ places: [], requests: [] });
    ctx.fetchImpl = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await expect(suggestPlaces(ctx, "Borivali", DEFAULT_BIAS)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("does not query providers for one-character input", async () => {
    const w = { places: [], requests: [] as URL[] };
    const r = await suggestPlaces(makeContext(w), "K", DEFAULT_BIAS);
    expect(r.suggestions).toEqual([]);
    expect(w.requests).toHaveLength(0);
  });
});
