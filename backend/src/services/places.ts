/**
 * Endpoint search. Geoapify and Mapbox Geocoding v6 are queried together
 * because each fails measured cases the other handles (see
 * docs/AUDIT_CHECKLIST.md). Results are merged, de-duplicated and ranked so
 * neighbourhood-level matches near the user's context come first.
 */
import type { LngLat, PlaceKind, PlaceSuggestion, ProviderStatus, Provider, SuggestResponse } from "../contract/api.js";
import { hasDevanagari, transliterateDevanagari } from "../domain/transliterate.js";
import { AppError } from "../errors.js";
import { haversineM } from "../lib/geo.js";
import { log } from "../lib/log.js";
import type { ProviderContext } from "../providers/context.js";
import { geoapifyAutocomplete, geoapifyReverse } from "../providers/geoapify.js";
import { mapboxGeocode, mapboxReverse } from "../providers/mapbox.js";

/** Default context: Mumbai, the first supported city. */
export const DEFAULT_BIAS: LngLat = [72.8777, 19.076];

/**
 * Documented spelling variants. Expansion only adds a canonical spelling for
 * the provider that handles variants poorly; the original text is still sent,
 * so distinct places are never silently replaced.
 */
const SPELLING_ALIASES: Array<[RegExp, string]> = [
  [/\bborivli\b/gi, "Borivali"],
  [/\bkandiv(?:li|ili|ali)\b|\bkandiwali\b/gi, "Kandivali"],
  [/\bgoregoan\b/gi, "Goregaon"],
  [/\bvile\s*parle\b/gi, "Vile Parle"],
  [/\bsantacruz\b/gi, "Santacruz"],
];

const SIDE_SUFFIXES: Array<[RegExp, string]> = [
  [/\s*\(\s*e(?:ast)?\s*\)\s*$/i, " East"],
  [/\s*\(\s*w(?:est)?\s*\)\s*$/i, " West"],
  [/\s+e\.?$/i, " East"],
  [/\s+w\.?$/i, " West"],
];

export function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim().slice(0, 100);
}

export function expandAliases(q: string): string {
  let out = normalizeQuery(q);
  for (const [re, canonical] of SPELLING_ALIASES) out = out.replace(re, canonical);
  for (const [re, side] of SIDE_SUFFIXES) {
    if (re.test(out)) {
      out = out.replace(re, side);
      break;
    }
  }
  return out;
}

const KIND_WEIGHT: Record<PlaceKind, number> = {
  neighbourhood: 0,
  locality: 0,
  suburb: 0,
  district: 1,
  city: 1,
  poi: 2,
  street: 2.5,
  address: 3,
  postcode: 3,
  region: 4,
};

const AREA_KINDS = new Set<PlaceKind>(["neighbourhood", "locality", "suburb"]);

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that don't identify a place on their own ("East Mankhurd" must not match "Borivali East"). */
const GENERIC_WORDS = new Set(["east", "west", "north", "south", "e", "w", "road", "rd", "station", "nagar", "the", "mumbai", "near"]);

function distinctiveTokens(q: string): string[] {
  return q.split(" ").filter((t) => t && !GENERIC_WORDS.has(t));
}

/** Query variants used for matching: aliases expanded, plus a Latin transliteration of Devanagari input. */
export function queryVariants(query: string): string[] {
  const variants = new Set([fold(expandAliases(query))]);
  if (hasDevanagari(query)) variants.add(fold(expandAliases(transliterateDevanagari(query))));
  return [...variants].filter(Boolean);
}

export function rankSuggestions(
  items: PlaceSuggestion[],
  query: string,
  near: LngLat,
  limit = 8
): PlaceSuggestion[] {
  const variants = queryVariants(query);
  const scored = items.map((s, i) => {
    const name = fold(expandAliases(s.name));
    const nameTokens = name.split(" ");
    const distKm = haversineM(s.coordinates, near) / 1000;
    let score = KIND_WEIGHT[s.kind];
    let textBonus = 0;
    let identifiesPlace = false;
    for (const q of variants) {
      if (name === q) textBonus = Math.max(textBonus, 1.5);
      else if (name.startsWith(q) || q.startsWith(name)) textBonus = Math.max(textBonus, 1);
      const distinctive = distinctiveTokens(q);
      if (distinctive.length === 0 || distinctive.every((t) => nameTokens.some((n) => n.startsWith(t)))) identifiesPlace = true;
    }
    score -= textBonus;
    if (!identifiesPlace) score += 2.5;
    // Continuous distance cost: ~1 point per 25 km from the user's context, capped.
    score += Math.min(4, distKm / 25);
    return { s, score, distKm, i };
  });
  scored.sort((a, b) => a.score - b.score || a.distKm - b.distKm || a.i - b.i);

  const kept: PlaceSuggestion[] = [];
  for (const { s } of scored) {
    const duplicate = kept.some((k) => {
      const sameName = fold(expandAliases(k.name)) === fold(expandAliases(s.name));
      const bothAreas = AREA_KINDS.has(k.kind) && AREA_KINDS.has(s.kind);
      const sameKind = k.kind === s.kind || bothAreas;
      return sameName && sameKind && haversineM(k.coordinates, s.coordinates) < 1500;
    });
    if (!duplicate) kept.push(s);
    if (kept.length >= limit) break;
  }
  return kept;
}

function statusFor(err: unknown): ProviderStatus {
  if (err instanceof AppError && err.code === "QUOTA_EXCEEDED") return "quota";
  if (err instanceof AppError && err.code === "NOT_CONFIGURED") return "disabled";
  return "error";
}

export async function suggestPlaces(
  ctx: ProviderContext,
  rawQuery: string,
  near: LngLat,
  signal?: AbortSignal
): Promise<SuggestResponse> {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2) return { suggestions: [], providers: {}, partial: false };
  // Geoapify handles alternative spellings and Devanagari poorly (measured), so it
  // receives the expanded/transliterated text; Mapbox receives what the user typed.
  const expanded = expandAliases(hasDevanagari(query) ? transliterateDevanagari(query) : query);

  const tasks: Array<[Provider, () => Promise<PlaceSuggestion[]>]> = [];
  const providers: SuggestResponse["providers"] = {};
  if (ctx.geoapifyKey) tasks.push(["geoapify", () => geoapifyAutocomplete(ctx, expanded, near, signal)]);
  else providers.geoapify = "disabled";
  if (ctx.mapboxToken) tasks.push(["mapbox", () => mapboxGeocode(ctx, query, near, signal)]);
  else providers.mapbox = "disabled";

  if (tasks.length === 0) throw new AppError("NOT_CONFIGURED", "Place search is not configured on this server.");

  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const merged: PlaceSuggestion[] = [];
  settled.forEach((r, i) => {
    const provider = tasks[i]![0];
    if (r.status === "fulfilled") {
      providers[provider] = "ok";
      merged.push(...r.value);
    } else {
      if (r.reason instanceof AppError && r.reason.code === "CANCELLED") throw r.reason;
      providers[provider] = statusFor(r.reason);
      log("warn", "places.provider_failed", { provider, code: (r.reason as AppError)?.code });
    }
  });

  const okCount = Object.values(providers).filter((s) => s === "ok").length;
  if (okCount === 0) {
    const quotaHit = Object.values(providers).includes("quota");
    throw quotaHit
      ? new AppError("QUOTA_EXCEEDED", "Place search has reached today's free usage limit. Try again tomorrow.")
      : new AppError("UPSTREAM_UNAVAILABLE", "Place search is unavailable right now. Please try again.");
  }

  return {
    suggestions: rankSuggestions(merged, query, near),
    providers,
    partial: okCount < tasks.length,
  };
}

export async function reversePlace(ctx: ProviderContext, point: LngLat, signal?: AbortSignal): Promise<PlaceSuggestion | null> {
  if (ctx.geoapifyKey) {
    try {
      const r = await geoapifyReverse(ctx, point, signal);
      if (r) return r;
    } catch (err) {
      if (err instanceof AppError && err.code === "CANCELLED") throw err;
      log("warn", "places.reverse_geoapify_failed", { code: (err as AppError)?.code });
    }
  }
  if (ctx.mapboxToken) return mapboxReverse(ctx, point, signal);
  throw new AppError("NOT_CONFIGURED", "Place lookup is not configured on this server.");
}
