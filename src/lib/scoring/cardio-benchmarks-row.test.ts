import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Part B (scoring-calibration-rewrite): row now uses sex-specific anchor
 * tables sourced from RowingRegimen's Concept2-logbook percentile data,
 * instead of a single male curve + generic female multiplier.
 */
describe("timeToScore — row (Part B corrected anchors)", () => {
  it("matches the corrected male percentile anchors", () => {
    expect(timeToScore("row", 370.2, "male")).toBeCloseTo(850, 0); // 6:10.2, 95th
    expect(timeToScore("row", 395.9, "male")).toBeCloseTo(725, 0); // 6:35.9, 80th
    expect(timeToScore("row", 424.6, "male")).toBeCloseTo(475, 0); // 7:04.6, 50th
    expect(timeToScore("row", 486.9, "male")).toBeCloseTo(125, 0); // 8:06.9, 5th
  });

  it("matches the corrected female percentile anchors", () => {
    expect(timeToScore("row", 423.9, "female")).toBeCloseTo(850, 0); // 7:03.9, 95th
    expect(timeToScore("row", 464.0, "female")).toBeCloseTo(725, 0); // 7:44.0, 80th
    expect(timeToScore("row", 510.2, "female")).toBeCloseTo(475, 0); // 8:30.2, 50th
  });

  it("no longer lets a beginner (bottom 5%) score into Intermediate territory", () => {
    // A beginner rower's ~8:07 2k should sit near the bottom of Beginner
    // (125), not Intermediate (the QA-flagged bug this corrects).
    expect(timeToScore("row", 486.9, "male")).toBeLessThan(250);
  });

  it("999 is reserved for the actual Concept2 2000m world record (user feedback: never achieved unless it's a world record for age/gender)", () => {
    expect(timeToScore("row", 5 * 60 + 33.4, "male")).toBe(999); // Simon van Dorp, 2026
    expect(timeToScore("row", 5 * 60 + 40, "male")).toBeLessThan(999);
    expect(timeToScore("row", 6 * 60 + 21.1, "female")).toBe(999); // Brooke Mooney, 2021
    expect(timeToScore("row", 6 * 60 + 30, "female")).toBeLessThan(999);
  });
});
