/**
 * Several free windows in one day, from the stored row to the engine.
 */
import { describe, expect, it } from "vitest";
import { parseDayWindows, parseIntakeRow, resolveIntakeInputs, type PrefilledFromSplitIndex } from "./intake-record";
import { validateIntakeValues } from "@/lib/validation/schemas/intake";

describe("parseDayWindows", () => {
  it("reads a day with several windows and derives the span and the two-sessions flag from them", () => {
    const [mon] = parseDayWindows([
      {
        day: "Mon",
        available: true,
        windows: [
          { start_hour: 18, end_hour: 21 },
          { start_hour: 6, end_hour: 7 },
        ],
      },
    ]);
    expect(mon.windows).toEqual([
      { startHour: 6, endHour: 7 },
      { startHour: 18, endHour: 21 },
    ]);
    expect(mon.startHour).toBe(6);
    expect(mon.endHour).toBe(21);
    expect(mon.twoSessions).toBe(true);
  });

  it("still reads a row written before windows existed", () => {
    const [wed] = parseDayWindows([{ day: "Wed", available: true, start_hour: 5.5, end_hour: 21, two_sessions: true }]);
    expect(wed).toEqual({ day: "Wed", available: true, startHour: 5.5, endHour: 21, twoSessions: true });
    expect(wed.windows).toBeUndefined();
  });

  it("accepts the camelCase spelling the API hands back", () => {
    const [sat] = parseDayWindows([
      { day: "Sat", available: true, windows: [{ startHour: 7, endHour: 9 }, { startHour: 16, endHour: 18 }] },
    ]);
    expect(sat.windows).toHaveLength(2);
    expect(sat.twoSessions).toBe(true);
  });

  it("drops an inverted or malformed window rather than throwing", () => {
    const [tue] = parseDayWindows([
      { day: "Tue", available: true, windows: [{ start_hour: 9, end_hour: 7 }, { start_hour: "x", end_hour: 12 }, { start_hour: 18, end_hour: 19 }] },
    ]);
    expect(tue.windows).toEqual([{ startHour: 18, endHour: 19 }]);
    expect(tue.twoSessions).toBe(false);
  });

  it("drops a day with neither windows nor a usable span", () => {
    expect(parseDayWindows([{ day: "Thu", available: true }])).toEqual([]);
  });
});

describe("the windows reach the engine's constraints", () => {
  const prefilled: PrefilledFromSplitIndex = {
    age: 30, sex: "male", bodyweightKg: 80, heightCm: 180, restingHr: 50, maxHr: 190,
    oneRms: {}, predicted5kS: 1200, predicted5kFromEffort: true, loggedWeeklyRunMinutes: 100, chronicLoad: 400,
  };

  it("carries a stated day's windows through and fills the rest from the flat hours", () => {
    const record = parseIntakeRow({
      days_available: ["Mon", "Tue", "Wed"],
      sections_completed: ["availability"],
      am_hour: 6,
      pm_hour: 19,
      two_a_days_possible: true,
      day_windows: [{ day: "Mon", available: true, windows: [{ start_hour: 6, end_hour: 7 }, { start_hour: 18, end_hour: 20 }] }],
    });
    const { constraints } = resolveIntakeInputs(record, prefilled);
    const mon = constraints.dayWindows.find((w) => w.day === "Mon")!;
    expect(mon.windows).toHaveLength(2);
    const tue = constraints.dayWindows.find((w) => w.day === "Tue")!;
    expect(tue).toMatchObject({ available: true, startHour: 6, endHour: 19, twoSessions: true });
    expect(tue.windows).toBeUndefined();
  });
});

describe("the write boundary", () => {
  it("accepts a day with several windows", () => {
    const { values, errors } = validateIntakeValues("availability", {
      day_windows: [
        { day: "Mon", available: true, start_hour: 6, end_hour: 21, two_sessions: false, windows: [{ start_hour: 6, end_hour: 7 }, { start_hour: 18, end_hour: 21 }] },
      ],
    });
    expect(errors).toEqual([]);
    expect((values.day_windows as unknown[]).length).toBe(1);
  });

  it("refuses an hour that is not on the clock", () => {
    const { errors } = validateIntakeValues("availability", {
      day_windows: [{ day: "Mon", available: true, windows: [{ start_hour: 25, end_hour: 26 }] }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].path).toBe("day_windows");
  });

  it("refuses more days than a week has", () => {
    const { errors } = validateIntakeValues("availability", {
      day_windows: Array.from({ length: 8 }, () => ({ day: "Mon", available: true })),
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
