/**
 * Normalized place-details model. Every field is nullable/empty when the
 * source does not supply it; nothing is inferred from a venue's name.
 */
import type { LngLat, Provider, VegetarianEvidence } from "../contract/api.js";

export interface MapboxPeriod {
  open: { day: number; time: string };
  close?: { day: number; time: string };
}

export type HoursSource =
  | { kind: "weekly-periods"; provider: Provider; periods: MapboxPeriod[] }
  | { kind: "osm"; provider: Provider; text: string };

export interface Venue {
  provider: Provider;
  providerId: string;
  /** Public listing URL, when the source has one (OpenStreetMap objects do). */
  sourceUrl: string | null;
  name: string;
  location: LngLat;
  /** Provider-supplied routable/access point, when one exists. */
  accessPoint: LngLat | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  venueType: string | null;
  cuisineTags: string[];
  hours: HoursSource | null;
  vegetarian: VegetarianEvidence;
}

/** A venue after cross-provider merging; keeps every contributing source. */
export interface MergedVenue extends Omit<Venue, "provider" | "providerId" | "hours" | "sourceUrl"> {
  id: string;
  sources: Array<{ provider: Provider; id: string; url?: string }>;
  hours: HoursSource[];
  vegetarianSource: Provider | null;
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(/[;,]/)[0]?.trim() ?? "";
  return /^\+?[\d\s()-]{6,20}$/.test(first) ? first : null;
}

export function osmObjectUrl(osmType: unknown, osmId: unknown): string | null {
  const types: Record<string, string> = { n: "node", w: "way", r: "relation", node: "node", way: "way", relation: "relation" };
  const t = typeof osmType === "string" ? types[osmType] : undefined;
  const id = typeof osmId === "number" || (typeof osmId === "string" && /^\d+$/.test(osmId)) ? String(osmId) : null;
  return t && id ? `https://www.openstreetmap.org/${t}/${id}` : null;
}

export function vegetarianFromOsm(tag: unknown): VegetarianEvidence {
  if (typeof tag !== "string") return "unknown";
  switch (tag.trim().toLowerCase()) {
    case "only":
      return "pure-veg";
    case "yes":
    case "limited":
      return "options";
    case "no":
      return "none";
    default:
      return "unknown";
  }
}
