import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Cycle 20k anchors, corrected against Cycling Regimen (cyclingregimen.com),
 * same sibling-site network and percentile convention as run/row/swim
 * (splitindex_calibration_master.py). High confidence for the 5/20/50/80/
 * 95th percentile points; the 99th-percentile anchor uses a separately-
 * sourced elite/pro estimate since that page had no WR column.
 */
describe("timeToScore — cycle (Cycling Regimen percentile anchors)", () => {
  it("matches the male percentile anchors", () => {
    expect(timeToScore("cycle", 1833.8, "male")).toBeCloseTo(925, 0); // 30:33.8, 99th
    expect(timeToScore("cycle", 2054, "male")).toBeCloseTo(850, 0); // 34:14, 95th
    expect(timeToScore("cycle", 2202, "male")).toBeCloseTo(725, 0); // 36:42, 80th
    expect(timeToScore("cycle", 2402, "male")).toBeCloseTo(475, 0); // 40:02, 50th
    expect(timeToScore("cycle", 2698, "male")).toBeCloseTo(250, 0); // 44:58, 20th
    expect(timeToScore("cycle", 3118, "male")).toBeCloseTo(125, 0); // 51:58, 5th
  });

  it("scores women on their own curve, at the 1.10 recreational sex ratio", () => {
    // Was a flat 1.219 multiplier with no source recorded, which claimed women
    // are 22% slower over 20km. The two figures that exist say 1.126 (UCI Hour
    // Record, elite) and 1.098 (IRONMAN 70.3 90km bike, 823,459 records) — see
    // CYCLE_20K_ANCHORS_FEMALE. Deliberately still FLAT: cycling's two sources
    // disagree about which direction the gap moves with ability, so a shaped
    // table would be picking a side the evidence contradicts.
    const male = timeToScore("cycle", 2400, "male");
    const female = timeToScore("cycle", 2400, "female");
    expect(female).toBeGreaterThan(male);
    // A woman 10% slower over the distance scores the same as the man. Within
    // a point either way: the female anchors are stored to a tenth of a second.
    expect(Math.abs(timeToScore("cycle", 2400 * 1.1, "female") - male)).toBeLessThanOrEqual(2);
  });
});
