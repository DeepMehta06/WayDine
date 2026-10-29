/**
 * Cuisine and venue-type normalization. Provider tags map onto a small set of
 * supported preference IDs; venue type (café, bakery…) is kept separate from
 * cuisine. Unmapped tags are still displayed but never match a preference.
 */
import type { CuisineId } from "../contract/api.js";

const CUISINE_ALIASES: Record<CuisineId, string[]> = {
  "north indian": ["north indian", "punjabi", "mughlai", "tandoori", "awadhi"],
  "south indian": ["south indian", "udupi", "udipi", "dosa", "idli", "kerala", "chettinad", "andhra"],
  maharashtrian: ["maharashtrian", "malvani", "konkani", "misal"],
  gujarati: ["gujarati", "kathiyawadi"],
  chinese: ["chinese", "indo chinese", "indo-chinese", "chinese restaurant"],
  pizza: ["pizza", "pizza restaurant"],
  burger: ["burger", "burger restaurant"],
  biryani: ["biryani"],
  seafood: ["seafood", "fish", "seafood restaurant"],
  cafe: ["cafe", "coffee shop", "coffee", "tea"],
  bakery: ["bakery", "cake"],
  dessert: ["dessert", "ice cream", "dessert shop", "sweets", "mithai"],
  "street food": ["street food", "chaat", "vada pav", "pav bhaji", "bhel"],
};

const IGNORED_TAGS = new Set(["regional", "food", "food and drink", "restaurant", "yes", "local"]);

/** Lower-cases, splits OSM-style `a;b` lists and turns underscores into spaces. */
export function normalizeCuisineTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out = new Set<string>();
  for (const part of raw.split(/[;,]/)) {
    const tag = part.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
    if (tag && !IGNORED_TAGS.has(tag) && tag.length <= 40) out.add(tag);
  }
  return [...out];
}

/** Maps Mapbox category IDs such as `chinese_restaurant` to readable tags. */
export function cuisineTagsFromMapboxCategories(ids: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const id of ids ?? []) {
    const m = /^([a-z_]+)_restaurant$/.exec(id);
    if (m && m[1]) out.add(m[1].replace(/_/g, " "));
    else if (["dessert_shop", "ice_cream", "bakery", "cafe", "coffee_shop", "bubble_tea"].includes(id)) {
      out.add(id.replace(/_/g, " "));
    }
  }
  return [...out].filter((t) => !IGNORED_TAGS.has(t));
}

export function cuisineIdsFor(tags: string[], venueType: string | null): Set<CuisineId> {
  const ids = new Set<CuisineId>();
  const haystack = new Set(tags);
  if (venueType) haystack.add(venueType);
  for (const [id, aliases] of Object.entries(CUISINE_ALIASES) as Array<[CuisineId, string[]]>) {
    if (aliases.some((a) => haystack.has(a))) ids.add(id);
  }
  return ids;
}

export function venueTypeFromGeoapify(categories: string[] | undefined): string | null {
  const c = new Set(categories ?? []);
  if (c.has("catering.food_court")) return "food court";
  if (c.has("catering.fast_food")) return "fast food";
  if (c.has("catering.cafe")) return "cafe";
  if (c.has("commercial.food_and_drink.bakery")) return "bakery";
  if (c.has("catering.restaurant")) return "restaurant";
  return null;
}

export function venueTypeFromMapbox(ids: string[] | undefined): string | null {
  const c = new Set(ids ?? []);
  if (c.has("food_court")) return "food court";
  if (c.has("fast_food")) return "fast food";
  if (c.has("cafe") || c.has("coffee_shop")) return "cafe";
  if (c.has("bakery")) return "bakery";
  if (c.has("restaurant") || [...c].some((x) => x.endsWith("_restaurant"))) return "restaurant";
  return null;
}
