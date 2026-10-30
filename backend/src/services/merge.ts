/**
 * Conservative venue de-duplication across and within providers. Two records
 * merge only when their names are near-identical AND they are within a short
 * distance, so separate branches of a chain stay separate.
 */
import type { Venue, MergedVenue } from "../domain/venue.js";
import { haversineM } from "../lib/geo.js";

const STOPWORDS = new Set(["the", "restaurant", "restro", "and", "pvt", "ltd", "private", "limited", "hotel"]);
export const SAME_PLACE_MAX_M = 75;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFC")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .join(" ");
}

function bigrams(s: string): Map<string, number> {
  const compact = s.replace(/\s+/g, "");
  const out = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character bigrams (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [, c] of ga) total += c;
  for (const [g, c] of gb) {
    total += c;
    overlap += Math.min(c, ga.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** True when every token of the shorter name (at least two tokens) appears in the longer one. */
function tokenSubset(a: string, b: string): boolean {
  const ta = normalizeName(a).split(" ").filter(Boolean);
  const tb = normalizeName(b).split(" ").filter(Boolean);
  const [small, large] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.length >= 2 && small.every((t) => large.has(t));
}

export function isSamePlace(a: Venue | MergedVenue, b: Venue): boolean {
  if (haversineM(a.location, b.location) > SAME_PLACE_MAX_M) return false;
  return nameSimilarity(a.name, b.name) >= 0.85 || tokenSubset(a.name, b.name);
}

function fromVenue(v: Venue): MergedVenue {
  return {
    id: `${v.provider}:${v.providerId}`,
    sources: [{ provider: v.provider, id: v.providerId, ...(v.sourceUrl ? { url: v.sourceUrl } : {}) }],
    name: v.name,
    location: v.location,
    accessPoint: v.accessPoint,
    address: v.address,
    phone: v.phone,
    website: v.website,
    venueType: v.venueType,
    cuisineTags: [...v.cuisineTags],
    hours: v.hours ? [v.hours] : [],
    vegetarian: v.vegetarian,
    vegetarianSource: v.vegetarian === "unknown" ? null : v.provider,
    ...(v.google ? { google: v.google } : {}),
  };
}

function absorb(target: MergedVenue, v: Venue): void {
  if (target.sources.some((s) => s.provider === v.provider && s.id === v.providerId)) return;
  target.sources.push({ provider: v.provider, id: v.providerId, ...(v.sourceUrl ? { url: v.sourceUrl } : {}) });
  // Mapbox supplies routable access points; prefer its geometry when present.
  if (v.accessPoint && !target.accessPoint) {
    target.accessPoint = v.accessPoint;
    target.location = v.location;
  }
  target.address ??= v.address;
  target.phone ??= v.phone;
  target.website ??= v.website;
  if (v.google && (!target.google || v.google.detailsStatus === "available")) target.google = v.google;
  target.venueType ??= v.venueType;
  target.cuisineTags = [...new Set([...target.cuisineTags, ...v.cuisineTags])];
  if (v.hours) target.hours.push(v.hours);
  if (target.vegetarian === "unknown" && v.vegetarian !== "unknown") {
    target.vegetarian = v.vegetarian;
    target.vegetarianSource = v.provider;
  } else if (target.vegetarian !== "unknown" && v.vegetarian !== "unknown" && target.vegetarian !== v.vegetarian) {
    // Contradictory dietary evidence is not evidence.
    target.vegetarian = "unknown";
    target.vegetarianSource = null;
  }
}

export function mergeVenues(venues: Venue[]): MergedVenue[] {
  const merged: MergedVenue[] = [];
  for (const v of venues) {
    const match = merged.find((m) => m.sources.some((source) => source.provider === v.provider && source.id === v.providerId) || isSamePlace(m, v));
    if (match) absorb(match, v);
    else merged.push(fromVenue(v));
  }
  return merged;
}
