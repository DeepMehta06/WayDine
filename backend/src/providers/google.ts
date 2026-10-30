/** Google Places (New). No persistent caching, background calls, photos downloads or retries. */
import { z } from "zod";
import type { GoogleRestaurantDetails, LngLat } from "../contract/api.js";
import { cleanPhone, safeHttpUrl, type MapboxPeriod, type Venue } from "../domain/venue.js";
import { normalizeCuisineTags } from "../domain/cuisine.js";
import { AppError } from "../errors.js";
import { fetchJson } from "../lib/http.js";
import type { ProviderContext } from "./context.js";

export const GOOGLE_NEARBY_LIMIT = 20;
export const GOOGLE_NEARBY_FIELDS = ["id", "displayName", "location", "formattedAddress", "shortFormattedAddress", "primaryType", "types", "businessStatus", "googleMapsUri", "attributions"];
export const GOOGLE_DETAILS_FIELDS = [...GOOGLE_NEARBY_FIELDS,
  "currentOpeningHours", "regularOpeningHours", "timeZone", "rating", "userRatingCount", "priceLevel", "priceRange",
  "servesVegetarianFood", "servesBreakfast", "servesLunch", "servesDinner", "servesBrunch", "servesCoffee", "servesDessert",
  "dineIn", "takeout", "photos", "nationalPhoneNumber", "websiteUri", "parkingOptions", "restroom", "accessibilityOptions", "goodForChildren", "menuForChildren", "paymentOptions",
];

const localized = z.object({ text: z.string().optional() });
const author = z.object({ displayName: z.string().optional(), uri: z.string().optional(), photoUri: z.string().optional() });
const time = z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23).default(0), minute: z.number().int().min(0).max(59).default(0) });
const schedule = z.object({ periods: z.array(z.unknown()).optional(), weekdayDescriptions: z.array(z.string()).optional() });
const money = z.object({ currencyCode: z.string(), units: z.string().default("0"), nanos: z.number().int().min(0).max(999999999).default(0) });
const place = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  displayName: z.object({ text: z.string().trim().min(1) }),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }),
  formattedAddress: z.string().optional(), shortFormattedAddress: z.string().optional(),
  primaryType: z.string().optional(), types: z.array(z.string()).optional(), businessStatus: z.string().optional(), googleMapsUri: z.string().optional(),
  rating: z.number().min(0).max(5).optional(), userRatingCount: z.number().int().nonnegative().optional(),
  priceLevel: z.string().optional(), priceRange: z.object({ startPrice: money.optional(), endPrice: money.optional() }).optional(),
  currentOpeningHours: schedule.optional(), regularOpeningHours: schedule.optional(), timeZone: z.object({ id: z.string() }).optional(),
  servesVegetarianFood: z.boolean().optional(), servesBreakfast: z.boolean().optional(), servesLunch: z.boolean().optional(), servesDinner: z.boolean().optional(),
  servesBrunch: z.boolean().optional(), servesCoffee: z.boolean().optional(), servesDessert: z.boolean().optional(), dineIn: z.boolean().optional(), takeout: z.boolean().optional(),
  restroom: z.boolean().optional(), goodForChildren: z.boolean().optional(), menuForChildren: z.boolean().optional(),
  parkingOptions: z.record(z.boolean()).optional(), accessibilityOptions: z.record(z.boolean()).optional(), paymentOptions: z.record(z.boolean()).optional(),
  nationalPhoneNumber: z.string().optional(), websiteUri: z.string().optional(),
  attributions: z.array(z.object({ provider: z.string(), providerUri: z.string().optional() })).optional(),
  photos: z.array(z.object({ name: z.string(), widthPx: z.number().int().positive().optional(), heightPx: z.number().int().positive().optional(), authorAttributions: z.array(author).optional() })).optional(),
  reviews: z.array(z.object({ rating: z.number().min(0).max(5).optional(), text: localized.optional(), publishTime: z.string().optional(), googleMapsUri: z.string().optional(), authorAttribution: author.optional() })).optional(),
});

function weeklyPeriods(raw: unknown[] | undefined): MapboxPeriod[] | null {
  if (!raw?.length) return null;
  const parsed = z.array(z.object({ open: time, close: time.optional() })).safeParse(raw);
  if (!parsed.success) return null;
  const periodTime = (t: z.infer<typeof time>) => ({ day: t.day, time: `${String(t.hour).padStart(2, "0")}${String(t.minute).padStart(2, "0")}` });
  return parsed.data.map((p) => ({ open: periodTime(p.open), ...(p.close ? { close: periodTime(p.close) } : {}) }));
}

function localDate(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

const authorInfo = (a: z.infer<typeof author>) => ({ displayName: a.displayName ?? "", uri: safeHttpUrl(a.uri), photoUri: safeHttpUrl(a.photoUri) });

export function toGoogleVenue(raw: unknown, fetchedAt = new Date(), detailed = false): Venue | null {
  const parsed = place.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const regular = weeklyPeriods(p.regularOpeningHours?.periods);
  const current = weeklyPeriods(p.currentOpeningHours?.periods);
  let zone = p.timeZone?.id ?? "Asia/Kolkata";
  try { localDate(fetchedAt, zone); } catch { zone = "Asia/Kolkata"; }
  const from = localDate(fetchedAt, zone);
  const end = new Date(`${from}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
  const google: GoogleRestaurantDetails = {
    placeId: p.id, googleMapsUri: safeHttpUrl(p.googleMapsUri), shortAddress: p.shortFormattedAddress ?? null,
    businessStatus: p.businessStatus ?? null, rating: p.rating ?? null, userRatingCount: p.userRatingCount ?? null,
    priceLevel: p.priceLevel ?? null, priceRange: p.priceRange ? { start: p.priceRange.startPrice ?? null, end: p.priceRange.endPrice ?? null } : null,
    servesVegetarianFood: p.servesVegetarianFood ?? null,
    meals: { breakfast: p.servesBreakfast ?? null, lunch: p.servesLunch ?? null, dinner: p.servesDinner ?? null, brunch: p.servesBrunch ?? null, coffee: p.servesCoffee ?? null, dessert: p.servesDessert ?? null },
    service: { dineIn: p.dineIn ?? null, takeout: p.takeout ?? null },
    amenities: { restroom: p.restroom ?? null, goodForChildren: p.goodForChildren ?? null, menuForChildren: p.menuForChildren ?? null, parking: p.parkingOptions ?? null, accessibility: p.accessibilityOptions ?? null, payment: p.paymentOptions ?? null },
    photos: (p.photos ?? []).slice(0, 5).map((photo) => ({ name: photo.name, widthPx: photo.widthPx ?? null, heightPx: photo.heightPx ?? null, authorAttributions: (photo.authorAttributions ?? []).map(authorInfo) })),
    reviews: (p.reviews ?? []).slice(0, 5).map((review) => ({ rating: review.rating ?? null, text: review.text?.text ?? null, publishTime: review.publishTime ?? null, googleMapsUri: safeHttpUrl(review.googleMapsUri), author: review.authorAttribution ? authorInfo(review.authorAttribution) : null })),
    attributions: (p.attributions ?? []).map((a) => ({ provider: a.provider, providerUri: safeHttpUrl(a.providerUri) })),
    detailsStatus: detailed ? "available" : "not-requested",
  };
  // Use structured types only. Names and reviews are never dietary/cuisine evidence.
  const cuisineTags = normalizeCuisineTags((p.types ?? []).filter((t) => t.endsWith("_restaurant") && t !== "vegetarian_restaurant" && t !== "vegan_restaurant").map((t) => t.replace(/_restaurant$/, "")).join(";"));
  const venueType = p.primaryType === "cafe" || p.primaryType === "coffee_shop" ? "cafe" : p.primaryType === "bakery" ? "bakery" : p.primaryType === "food_court" ? "food court" : "restaurant";
  return {
    provider: "google", providerId: p.id, sourceUrl: google.googleMapsUri, name: p.displayName.text,
    location: [p.location.longitude, p.location.latitude], accessPoint: null,
    address: p.formattedAddress ?? null, phone: cleanPhone(p.nationalPhoneNumber), website: safeHttpUrl(p.websiteUri),
    venueType, cuisineTags,
    hours: regular || p.currentOpeningHours ? { kind: "google", provider: "google", regular, current, currentFrom: p.currentOpeningHours ? from : null, currentThrough: p.currentOpeningHours ? end.toISOString().slice(0, 10) : null, text: (p.currentOpeningHours?.weekdayDescriptions ?? p.regularOpeningHours?.weekdayDescriptions)?.join("; ") ?? null, timeZone: zone } : null,
    vegetarian: p.servesVegetarianFood === true ? "options" : p.servesVegetarianFood === false ? "none" : "unknown",
    google,
  };
}

function enabled(ctx: ProviderContext): string {
  if (!ctx.googlePlacesEnabled || !ctx.googlePlacesKey) throw new AppError("NOT_CONFIGURED", "Google Places is disabled. Configure its key and explicitly enable it before making live requests.");
  return ctx.googlePlacesKey;
}

export function googleStatusError(status: number): AppError | undefined {
  if (status === 401 || status === 403) return new AppError("NOT_CONFIGURED", "Google Places rejected the request. Check API enablement, billing and API-key restrictions.");
  if (status === 429) return new AppError("RATE_LIMITED", "Google Places has reached a request or quota limit.", { retryAfterSec: 60 });
  if (status === 404) return new AppError("BAD_REQUEST", "This Google restaurant listing is no longer available.");
  return undefined;
}

async function request<T>(ctx: ProviderContext, path: string, fields: string[], schema: z.ZodType<T>, opts: { body?: unknown; signal?: AbortSignal; details: boolean }): Promise<T> {
  const key = enabled(ctx);
  const bucket = opts.details ? "google_places_details" : "google_places_nearby";
  return fetchJson({
    url: `https://places.googleapis.com/v1/${path}`, schema, provider: "google-places", quota: ctx.quota,
    budget: { bucket, units: 1 }, additionalBudget: ctx.googleMonthlyQuota ? { quota: ctx.googleMonthlyQuota, bucket, units: 1 } : undefined,
    method: opts.body ? "POST" : "GET", body: opts.body ? JSON.stringify(opts.body) : undefined,
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields.join(","), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    retries: 0, logResponseBody: false, signal: opts.signal, fetchImpl: ctx.fetchImpl, mapStatus: googleStatusError,
  });
}

export async function googleNearby(ctx: ProviderContext, center: LngLat, radiusM: number, signal?: AbortSignal): Promise<{ venues: Venue[]; malformed: number; saturated: boolean }> {
  enabled(ctx);
  if (!(radiusM > 0 && radiusM <= 50000)) throw new AppError("BAD_REQUEST", "This route is too long for the configured Google search budget. Increase its search-area limit or use a shorter route.");
  const result = await request(ctx, "places:searchNearby", GOOGLE_NEARBY_FIELDS.map((field) => `places.${field}`), z.object({ places: z.array(z.unknown()).default([]) }), {
    details: false, signal,
    body: { includedTypes: ["restaurant", "cafe", "bakery", "meal_takeaway"], maxResultCount: GOOGLE_NEARBY_LIMIT, rankPreference: "DISTANCE", languageCode: "en", locationRestriction: { circle: { center: { latitude: center[1], longitude: center[0] }, radius: radiusM } } },
  });
  const venues: Venue[] = []; let malformed = 0;
  const places = result.places ?? [];
  for (const raw of places) { const venue = toGoogleVenue(raw); if (venue) venues.push(venue); else malformed++; }
  return { venues, malformed, saturated: places.length >= GOOGLE_NEARBY_LIMIT };
}

/** Photo resource names as returned in Place Details: places/{placeId}/photos/{reference}. */
export const GOOGLE_PHOTO_NAME = /^places\/[A-Za-z0-9_-]{1,256}\/photos\/[A-Za-z0-9_-]{1,1024}$/;

/**
 * Resolves one photo to a short-lived Google-hosted image URL. One billable
 * Place Photo request per call; nothing is downloaded or stored by WayDine.
 */
export async function googlePhotoUri(ctx: ProviderContext, name: string, maxWidthPx: number, signal?: AbortSignal): Promise<string> {
  const key = enabled(ctx);
  if (!GOOGLE_PHOTO_NAME.test(name)) throw new AppError("BAD_REQUEST", "Invalid Google photo reference.");
  const width = Math.min(1600, Math.max(200, Math.round(maxWidthPx)));
  const result = await fetchJson({
    url: `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`,
    schema: z.object({ photoUri: z.string() }), provider: "google-places", quota: ctx.quota,
    budget: { bucket: "google_places_photos", units: 1 },
    additionalBudget: ctx.googleMonthlyQuota ? { quota: ctx.googleMonthlyQuota, bucket: "google_places_photos", units: 1 } : undefined,
    headers: { "X-Goog-Api-Key": key }, retries: 0, logResponseBody: false, signal, fetchImpl: ctx.fetchImpl, mapStatus: googleStatusError,
  });
  const uri = safeHttpUrl(result.photoUri);
  if (!uri || !/^https:\/\/[a-z0-9.-]+\.(googleusercontent|ggpht|googleapis)\.com\//.test(uri)) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "Google returned an unexpected photo address.");
  }
  return uri;
}

export async function googleDetails(ctx: ProviderContext, id: string, signal?: AbortSignal, includeReviews = false): Promise<Venue> {
  enabled(ctx);
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new AppError("BAD_REQUEST", "Invalid Google place ID.");
  const run = async (sharedSignal?: AbortSignal) => {
    const raw = await request(ctx, `places/${encodeURIComponent(id)}?languageCode=en`, [...GOOGLE_DETAILS_FIELDS, ...(includeReviews ? ["reviews"] : [])], z.unknown(), { details: true, signal: sharedSignal });
    const venue = toGoogleVenue(raw, new Date(), true);
    if (!venue || venue.providerId !== id) throw new AppError("UPSTREAM_UNAVAILABLE", "Google returned incomplete restaurant details.");
    return venue;
  };
  // Share simultaneous requests only; never retain returned Google content after completion.
  return ctx.googleInFlight
    ? await ctx.googleInFlight.run(`details:${id}:${includeReviews}`, signal, run) as Venue
    : run(signal);
}
