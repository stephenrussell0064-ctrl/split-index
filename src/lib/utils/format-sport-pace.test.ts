import { describe, expect, it } from "vitest";
import { formatSportPace } from "./format";
import { sportMetricLabel } from "./scoring-display";

/**
 * Per-sport pace units.
 *
 * Reported defect: the logbook rendered every sport's split as /km, so a swim
 * read as "46:00/km" — swimming is universally spoken in sec/100m, and the
 * ergs in sec/500m. `sportMetricLabel` in scoring-display.ts had DECLARED that
 * convention all along ("pace per 100m", "split / 500m"); there was simply no
 * formatter implementing it, and the three hand-rolled copies that existed
 * covered only the ergs and had drifted apart on spacing.
 *
 * These tests pin the units themselves rather than the surfaces, because the
 * point of the fix is that there is now one definition behind every surface.
 */
describe("formatSportPace", () => {
  it("quotes swimming per 100m, the unit swimmers actually use", () => {
    // 2:20/100m held for a swim = 23:20/km.
    expect(formatSportPace("swimming", { avgPaceSecondsPerKm: 1400 })).toBe("2:20/100m");
    // The reported session: 1000m in 46:00 = 4:36/100m, not "46:00/km".
    expect(formatSportPace("swimming", { avgPaceSecondsPerKm: 2760 })).toBe("4:36/100m");
  });

  it("quotes the ergs per 500m, straight from their own stored split column", () => {
    expect(formatSportPace("rowing", { avgSplitSeconds: 124 })).toBe("2:04/500m");
    expect(formatSportPace("ski_erg", { avgSplitSeconds: 130 })).toBe("2:10/500m");
  });

  it("derives an erg split from a per-km pace when that is all the session has", () => {
    // Imported/manual erg sessions can arrive with only the per-km column.
    expect(formatSportPace("rowing", { avgPaceSecondsPerKm: 248 })).toBe("2:04/500m");
  });

  it("leaves running and walking per km, and cycling as speed", () => {
    expect(formatSportPace("running", { avgPaceSecondsPerKm: 265 })).toBe("4:25/km");
    expect(formatSportPace("walking", { avgPaceSecondsPerKm: 720 })).toBe("12:00/km");
    expect(formatSportPace("outdoor_cycling", { avgPaceSecondsPerKm: 120 })).toBe("30.0 km/h");
  });

  it("returns null rather than a dash when there is nothing to show", () => {
    expect(formatSportPace("running", { avgPaceSecondsPerKm: null })).toBeNull();
    expect(formatSportPace("running", { avgPaceSecondsPerKm: 0 })).toBeNull();
    expect(formatSportPace("rowing", { avgSplitSeconds: null, avgPaceSecondsPerKm: null })).toBeNull();
  });

  /**
   * The two halves of the convention must not drift apart again: whatever unit
   * the label promises is the unit the formatter has to produce.
   */
  it("agrees with the unit sportMetricLabel advertises", () => {
    expect(sportMetricLabel("swimming")).toContain("100m");
    expect(formatSportPace("swimming", { avgPaceSecondsPerKm: 1400 })).toContain("/100m");

    expect(sportMetricLabel("rowing")).toContain("500m");
    expect(formatSportPace("rowing", { avgSplitSeconds: 124 })).toContain("/500m");

    expect(sportMetricLabel("outdoor_cycling")).toBe("speed");
    expect(formatSportPace("outdoor_cycling", { avgPaceSecondsPerKm: 120 })).toContain("km/h");
  });
});
