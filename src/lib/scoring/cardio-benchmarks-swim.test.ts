import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Swim 400m anchors, corrected against Swimming Regimen
 * (swimmingregimen.com), same sibling-site network and percentile
 * convention as run/row/cycle (splitindex_calibration_master.py). High
 * confidence for the 5/20/50/80/95th percentile points; the 99th-percentile
 * anchor uses a separately-sourced WR estimate since that page had no WR
 * column.
 */
describe("timeToScore — swim (Swimming Regimen percentile anchors)", () => {
  it("matches the male percentile anchors", () => {
    expect(timeToScore("swim", 269.5, "male")).toBeCloseTo(925, 0); // 4:29.5, 99th
    expect(timeToScore("swim", 290.7, "male")).toBeCloseTo(850, 0); // 4:50.7, 95th
    expect(timeToScore("swim", 304, "male")).toBeCloseTo(725, 0); // 5:04.0, 80th
    expect(timeToScore("swim", 317.1, "male")).toBeCloseTo(475, 0); // 5:17.1, 50th
    expect(timeToScore("swim", 343.5, "male")).toBeCloseTo(250, 0); // 5:43.5, 20th
    expect(timeToScore("swim", 370.1, "male")).toBeCloseTo(125, 0); // 6:10.1, 5th
  });

  it("still applies the female multiplier (1.073) on top (no sex-specific swim data captured)", () => {
    const male = timeToScore("swim", 320, "male");
    const female = timeToScore("swim", 320, "female");
    expect(female).toBeGreaterThan(male);
  });
});
