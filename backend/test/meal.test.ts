import { describe, expect, it } from "vitest";
import { mealService, mealRecommendation } from "../src/services/meal.js";
import { mealPeriodAt } from "../src/lib/time.js";

const unknown = { breakfast: null, lunch: null, dinner: null, brunch: null, coffee: null, dessert: null };

describe("meal service and ideas", () => {
  it("distinguishes explicit lunch and dinner flags from unknown data", () => {
    expect(mealService("lunch", { ...unknown, lunch: false })).toBe("not-listed");
    expect(mealService("dinner", { ...unknown, dinner: true })).toBe("listed");
    expect(mealService("dinner", unknown)).toBe("unknown");
    expect(mealService("dinner")).toBe("unknown");
  });
  it("allows brunch as a breakfast alternative and does not assume absent brunch", () => {
    expect(mealService("breakfast", { ...unknown, breakfast: false, brunch: true })).toBe("listed");
    expect(mealService("breakfast", { ...unknown, breakfast: false })).toBe("unknown");
    expect(mealService("breakfast", { ...unknown, breakfast: false, brunch: false })).toBe("not-listed");
  });
  it("does not infer that snacks or late-night food are unavailable", () => {
    expect(mealService("snacks", { ...unknown, coffee: false, dessert: false })).toBe("unknown");
    expect(mealService("snacks", { ...unknown, coffee: true })).toBe("listed");
    expect(mealService("late night", { ...unknown, dinner: false })).toBe("unknown");
  });
  it("only suggests ideas for matching listed cuisines and labels them as unverified", () => {
    const result = mealRecommendation("breakfast", unknown, ["south indian", "north indian"], "restaurant", ["south indian"]);
    expect(result.ideas).toEqual(["Idli", "Dosa"]);
    expect(result.disclaimer).toContain("not verified");
    expect(mealRecommendation("breakfast", unknown, [], "restaurant", []).ideas).toEqual([]);
  });
  it("changes meal periods at India time boundaries", () => {
    expect(mealPeriodAt(new Date("2026-01-01T10:59:59+05:30"))).toBe("breakfast");
    expect(mealPeriodAt(new Date("2026-01-01T11:00:00+05:30"))).toBe("lunch");
    expect(mealPeriodAt(new Date("2026-01-01T23:00:00+05:30"))).toBe("late night");
  });
});
