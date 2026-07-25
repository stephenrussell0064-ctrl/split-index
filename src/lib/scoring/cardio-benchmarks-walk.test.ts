import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Part D (scoring-calibration-rewrite): lighter-touch walk pace correction —
 * only the 12:00/km and 10:00/km anchors were lowered, the rest unchanged.
 */
describe("timeToScore — walk (Part D lighter-touch correction)", () => {
  it("no longer scores a ~12min/km (near-default adult) pace as solidly Intermediate", () => {
    const score = timeToScore("walk", 720, "male"); // 12:00/km
    expect(score).toBeCloseTo(300, 0);
    expect(score).toBeLessThan(475); // below the Intermediate/Semi-Pro boundary
  });

  it("lowers the 10:00/km anchor proportionally", () => {
    expect(timeToScore("walk", 600, "male")).toBeCloseTo(500, 0);
  });

  it("leaves the fast-end anchors unchanged", () => {
    expect(timeToScore("walk", 420, "male")).toBeCloseTo(925, 0); // 7:00/km
    expect(timeToScore("walk", 480, "male")).toBeCloseTo(875, 0); // 8:00/km
  });
});
