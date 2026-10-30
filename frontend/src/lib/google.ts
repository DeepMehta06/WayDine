/** Readable labels for Google Places fields. Missing data stays missing (null / empty). */
import type { GoogleRestaurantDetails } from "@contract";

const PRICE_LEVEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "₹",
  PRICE_LEVEL_MODERATE: "₹₹",
  PRICE_LEVEL_EXPENSIVE: "₹₹₹",
  PRICE_LEVEL_VERY_EXPENSIVE: "₹₹₹₹",
};

function rupees(m: { currencyCode: string; units: string } | null): number | null {
  if (!m || m.currencyCode !== "INR") return null;
  const n = Number(m.units);
  return Number.isFinite(n) ? n : null;
}

/** "₹200–400 per person", "₹₹", or null when Google lists nothing. */
export function priceLabel(g: GoogleRestaurantDetails | undefined): string | null {
  if (!g) return null;
  const start = rupees(g.priceRange?.start ?? null);
  const end = rupees(g.priceRange?.end ?? null);
  if (start !== null && end !== null) return `₹${start.toLocaleString("en-IN")}–${end.toLocaleString("en-IN")}`;
  if (start !== null) return `From ₹${start.toLocaleString("en-IN")}`;
  if (end !== null) return `Up to ₹${end.toLocaleString("en-IN")}`;
  return g.priceLevel ? (PRICE_LEVEL[g.priceLevel] ?? null) : null;
}

export function ratingCountLabel(n: number | null): string {
  if (n === null) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

const MEALS: Array<[keyof GoogleRestaurantDetails["meals"], string]> = [
  ["breakfast", "Breakfast"],
  ["brunch", "Brunch"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
  ["coffee", "Coffee"],
  ["dessert", "Dessert"],
];

export function mealsServed(g: GoogleRestaurantDetails): { served: string[]; notServed: string[] } {
  const served: string[] = [];
  const notServed: string[] = [];
  for (const [k, label] of MEALS) {
    if (g.meals[k] === true) served.push(label);
    else if (g.meals[k] === false) notServed.push(label);
  }
  return { served, notServed };
}

const OPTION_LABEL: Record<string, string> = {
  freeParkingLot: "Free parking lot",
  paidParkingLot: "Paid parking lot",
  freeStreetParking: "Free street parking",
  paidStreetParking: "Paid street parking",
  valetParking: "Valet parking",
  freeGarageParking: "Free garage parking",
  paidGarageParking: "Paid garage parking",
  wheelchairAccessibleEntrance: "Wheelchair-accessible entrance",
  wheelchairAccessibleParking: "Wheelchair-accessible parking",
  wheelchairAccessibleRestroom: "Wheelchair-accessible restroom",
  wheelchairAccessibleSeating: "Wheelchair-accessible seating",
  acceptsCreditCards: "Credit cards",
  acceptsDebitCards: "Debit cards",
  acceptsCashOnly: "Cash only",
  acceptsNfc: "Tap to pay (NFC)",
};

function humanize(key: string): string {
  return OPTION_LABEL[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

/** Only options Google marks true. False values are omitted rather than shown as negatives. */
export function trueOptions(record: Record<string, boolean> | null): string[] {
  if (!record) return [];
  return Object.entries(record)
    .filter(([, v]) => v === true)
    .map(([k]) => humanize(k));
}

export function businessStatusLabel(status: string | null): string | null {
  if (status === "CLOSED_TEMPORARILY") return "Temporarily closed";
  if (status === "CLOSED_PERMANENTLY") return "Permanently closed";
  return null;
}
