import { describe, expect, it } from "vitest";
import { assessBudget } from "../src/services/budget.js";

const money = (units: string, nanos = 0, currencyCode = "INR") => ({ units, nanos, currencyCode });

describe("per-person budget", () => {
  it("excludes a typical range only if its lower bound exceeds the limit", () => {
    expect(assessBudget(300, { start: money("300", 1), end: money("600") })).toBe("above-range");
    expect(assessBudget(300, { start: money("300"), end: money("600") })).toBe("unconfirmed");
    expect(assessBudget(300, { start: money("400"), end: null })).toBe("above-range");
  });
  it("recognizes ranges below the limit, while marking overlaps and missing prices unknown", () => {
    expect(assessBudget(300, { start: money("100"), end: money("300") })).toBe("likely-within");
    expect(assessBudget(300, { start: money("100"), end: money("500") })).toBe("unconfirmed");
    expect(assessBudget(300, { start: money("100"), end: null })).toBe("unconfirmed");
    expect(assessBudget(300, null)).toBe("unconfirmed");
    expect(assessBudget(null, { start: money("400"), end: null })).toBe("not-set");
  });
  it("never compares invalid, inconsistent or non-INR prices", () => {
    expect(assessBudget(300, { start: money("500", 0, "USD"), end: null })).toBe("unconfirmed");
    expect(assessBudget(300, { start: money("500"), end: money("200") })).toBe("unconfirmed");
    expect(assessBudget(300, { start: money("-10"), end: null })).toBe("unconfirmed");
    expect(assessBudget(300, { start: money("bad"), end: null })).toBe("unconfirmed");
  });
});
