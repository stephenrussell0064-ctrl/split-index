import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HALF_HOUR_OPTIONS, formatHour } from "./time-of-day-select";

describe("half-hour options", () => {
  it("covers the whole day on the half hour", () => {
    expect(HALF_HOUR_OPTIONS).toHaveLength(48);
    expect(HALF_HOUR_OPTIONS[0]).toEqual({ value: 0, label: "00:00" });
    expect(HALF_HOUR_OPTIONS[1]).toEqual({ value: 0.5, label: "00:30" });
    expect(HALF_HOUR_OPTIONS[47]).toEqual({ value: 23.5, label: "23:30" });
  });

  it("stays inside the column's CHECK constraint", () => {
    // am_hour and pm_hour are NUMERIC(4,2) CHECK (BETWEEN 0 AND 23.99). An
    // option outside that range would be rejected by the database on save,
    // which the athlete would see as the form silently failing.
    for (const o of HALF_HOUR_OPTIONS) {
      expect(o.value).toBeGreaterThanOrEqual(0);
      expect(o.value).toBeLessThanOrEqual(23.99);
      // NUMERIC(4,2) keeps two decimals; .5 and .0 both survive exactly.
      expect(Number(o.value.toFixed(2))).toBe(o.value);
    }
  });

  it("labels every option as a 24-hour clock time", () => {
    for (const o of HALF_HOUR_OPTIONS) expect(o.label).toMatch(/^([01]\d|2[0-3]):(00|30)$/);
  });
});

describe("formatHour", () => {
  it("renders whole and half hours", () => {
    expect(formatHour(7)).toBe("07:00");
    expect(formatHour(7.5)).toBe("07:30");
    expect(formatHour(18)).toBe("18:00");
  });

  it("renders a stored value that is not on the half hour", () => {
    // day_windows is free-form JSON, so 07:15 can exist. It is displayed as
    // itself rather than snapped, so opening the screen does not rewrite it.
    expect(formatHour(7.25)).toBe("07:15");
  });

  it("does not produce a 60th minute when rounding up", () => {
    // 7.999 * 60 rounds to 60, which would render "07:60".
    expect(formatHour(7.999)).toBe("08:00");
  });

  it("clamps rather than emitting a negative or 24+ clock", () => {
    expect(formatHour(-1)).toBe("00:00");
    expect(formatHour(25)).toBe("23:59");
  });
});

describe("clock times are picked, not typed", () => {
  /*
   * The defect this guards: a free number input bound to a handler that
   * coerces empty back to a default. `v ?? 7` in the wizard and `Number("")`
   * — which is 0 — in the per-day editor both made the field impossible to
   * clear and retype, so the time could not be changed at all on a device.
   *
   * Durations are deliberately not covered. "Hours between events", "longest
   * session" and "nightly sleep" are quantities, not clock times, and a
   * number input is the right control for them.
   */
  const SOURCES = [
    "src/components/hybrid-plan/intake-wizard.tsx",
    "src/components/hybrid-plan/intake-fields.tsx",
  ];

  it("no clock-time field is a free number input", () => {
    const offenders: string[] = [];
    for (const rel of SOURCES) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      // An aria-label naming a training time, on an <input> rather than the select.
      for (const m of src.matchAll(/<input[\s\S]{0,400}?aria-label=\{?[^>]*?(training (hour|time)|start (hour|time)|end (hour|time))/gi)) {
        offenders.push(`${rel}:${src.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("both training times and both day-window bounds use the select", () => {
    const wizard = readFileSync(
      join(process.cwd(), "src/components/hybrid-plan/intake-wizard.tsx"),
      "utf8",
    );
    const fields = readFileSync(
      join(process.cwd(), "src/components/hybrid-plan/intake-fields.tsx"),
      "utf8",
    );
    expect((wizard.match(/<TimeOfDaySelect/g) ?? []).length).toBe(2);
    expect((fields.match(/<TimeOfDaySelect/g) ?? []).length).toBe(2);
  });
});
