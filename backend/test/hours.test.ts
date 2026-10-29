import { afterEach, describe, expect, it } from "vitest";
import { evaluateHours, periodsToIntervals } from "../src/services/hours.js";
import { mealPeriodAt, minuteOfWeek } from "../src/lib/time.js";
import type { HoursSource } from "../src/domain/venue.js";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

const weekly = (periods: Extract<HoursSource, { kind: "weekly-periods" }>["periods"]): HoursSource => ({
  kind: "weekly-periods",
  provider: "mapbox",
  periods,
});

// 2026-10-27 is a Tuesday.
const tuesdayNoonIst = new Date("2026-10-27T12:00:00+05:30");

describe("#35 opening-hours normalization", () => {
  it("treats a Monday 09:00 -> Wednesday 17:00 period as open on Tuesday", () => {
    const src = weekly([{ open: { day: 1, time: "0900" }, close: { day: 3, time: "1700" } }]);
    expect(evaluateHours([src], tuesdayNoonIst).atArrival).toBe("open");
  });

  it("handles overnight periods into the next day", () => {
    const src = weekly([{ open: { day: 5, time: "2000" }, close: { day: 6, time: "0200" } }]);
    expect(evaluateHours([src], new Date("2026-10-31T01:00:00+05:30")).atArrival).toBe("open"); // Sat 01:00
    expect(evaluateHours([src], new Date("2026-10-31T03:00:00+05:30")).atArrival).toBe("closed");
  });

  it("reads a same-day close before opening as the next day (live Mapbox shape: 16:30 -> 00:30)", () => {
    const periods = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, time: "1630" }, close: { day: d, time: "0030" } }));
    const src = weekly(periods);
    expect(evaluateHours([src], new Date("2026-10-30T12:01:00+05:30")).atArrival).toBe("closed"); // Fri noon
    expect(evaluateHours([src], new Date("2026-10-30T17:00:00+05:30")).atArrival).toBe("open");
    expect(evaluateHours([src], new Date("2026-10-31T00:15:00+05:30")).atArrival).toBe("open"); // after midnight
    expect(evaluateHours([src], new Date("2026-10-31T00:45:00+05:30")).atArrival).toBe("closed");
  });

  it("reads a same-day 00:00 close as midnight at the end of that day", () => {
    const src = weekly([{ open: { day: 5, time: "1200" }, close: { day: 5, time: "0000" } }]);
    expect(evaluateHours([src], new Date("2026-10-30T23:30:00+05:30")).atArrival).toBe("open");
    expect(evaluateHours([src], new Date("2026-10-31T11:00:00+05:30")).atArrival).toBe("closed");
  });

  it("wraps Saturday night into Sunday morning", () => {
    const src = weekly([{ open: { day: 6, time: "2200" }, close: { day: 0, time: "0300" } }]);
    expect(evaluateHours([src], new Date("2026-11-01T02:00:00+05:30")).atArrival).toBe("open"); // Sun 02:00
  });

  it("models 24/7 explicitly", () => {
    expect(periodsToIntervals([{ open: { day: 0, time: "0000" } }])).toEqual([[0, 10080]]);
    expect(evaluateHours([weekly([{ open: { day: 0, time: "0000" } }])], tuesdayNoonIst).atArrival).toBe("open");
  });

  it("reports a schedule with a missing close time as unknown rather than guessing", () => {
    const src = weekly([
      { open: { day: 1, time: "0900" } },
      { open: { day: 2, time: "0900" }, close: { day: 2, time: "1700" } },
    ]);
    expect(evaluateHours([src], tuesdayNoonIst).atArrival).toBe("unknown");
  });

  it("parses OSM opening_hours strings", () => {
    const src: HoursSource = { kind: "osm", provider: "geoapify", text: "Mo-Su 07:30-23:30" };
    expect(evaluateHours([src], tuesdayNoonIst).atArrival).toBe("open");
    expect(evaluateHours([src], new Date("2026-10-27T05:00:00+05:30")).atArrival).toBe("closed");
  });

  it("returns unknown for unparseable OSM strings", () => {
    const src: HoursSource = { kind: "osm", provider: "geoapify", text: "call ahead!!" };
    expect(evaluateHours([src], tuesdayNoonIst).atArrival).toBe("unknown");
  });

  it("returns unknown when sources disagree", () => {
    const open: HoursSource = { kind: "osm", provider: "geoapify", text: "Mo-Su 07:00-23:00" };
    const closed = weekly([{ open: { day: 2, time: "1800" }, close: { day: 2, time: "2300" } }]);
    const r = evaluateHours([open, closed], tuesdayNoonIst);
    expect(r.atArrival).toBe("unknown");
    expect(r.conflict).toBe(true);
  });

  it("reports minutes to closing when it is within the hour", () => {
    const src = weekly([{ open: { day: 2, time: "0900" }, close: { day: 2, time: "1220" } }]);
    expect(evaluateHours([src], tuesdayNoonIst).closesWithinMinutes).toBe(20);
  });
});

describe("#32 decisions use restaurant time, not server time", () => {
  for (const tz of ["UTC", "Asia/Kolkata", "America/Los_Angeles"]) {
    it(`gives the same meal period and opening state with TZ=${tz}`, () => {
      process.env.TZ = tz;
      const instant = new Date("2026-10-29T12:00:00+05:30");
      expect(mealPeriodAt(instant)).toBe("lunch");
      expect(minuteOfWeek(instant)).toBe(4 * 1440 + 12 * 60);
      const osm: HoursSource = { kind: "osm", provider: "geoapify", text: "Th 11:00-13:00" };
      expect(evaluateHours([osm], instant).atArrival).toBe("open");
      const mbx = weekly([{ open: { day: 4, time: "1100" }, close: { day: 4, time: "1300" } }]);
      expect(evaluateHours([mbx], instant).atArrival).toBe("open");
    });
  }
});
