import type { GoogleRestaurantDetails } from "../contract/api.js";

type Money = NonNullable<NonNullable<GoogleRestaurantDetails["priceRange"]>["start"]>;
type Range = GoogleRestaurantDetails["priceRange"];
export type BudgetDecision = "not-set" | "likely-within" | "unconfirmed" | "above-range";

/** Use integer nanos to avoid floating-point and unsafe integer comparisons. */
function inrNanos(money: Money | null): bigint | null {
  if (!money || money.currencyCode !== "INR" || !/^(0|[1-9]\d{0,18})$/.test(money.units) || !Number.isInteger(money.nanos) || money.nanos < 0 || money.nanos > 999_999_999) return null;
  return BigInt(money.units) * 1_000_000_000n + BigInt(money.nanos);
}

/** Google ranges estimate typical spending, not the price of a specific meal. */
export function assessBudget(budget: number | null | undefined, range: Range | undefined): BudgetDecision {
  if (budget == null) return "not-set";
  if (!Number.isSafeInteger(budget) || budget <= 0 || !range) return "unconfirmed";
  const start = inrNanos(range.start); const end = inrNanos(range.end);
  if ((range.start && start === null) || (range.end && end === null) || (start !== null && end !== null && start >= end)) return "unconfirmed";
  const limit = BigInt(budget) * 1_000_000_000n;
  if (start !== null && start > limit) return "above-range";
  if (end !== null && end <= limit) return "likely-within";
  return "unconfirmed";
}
