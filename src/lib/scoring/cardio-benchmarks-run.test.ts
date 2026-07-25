import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Part C (scoring-calibration-rewrite): corrected run 5k anchors. Moderate
 * confidence — synthesized from several percentile-tagged sources rather
 * than one clean table, unlike Part B's rowing data.
 */
describe("timeToScore — run (Part C corrected anchors)", () => {
  it("matches the corrected male percentile anchors", () => {
    expect(timeToScore("run", 1140, "male")).toBeCloseTo(850, 0); // 19:00, 95th
    expect(timeToScore("run", 1320, "male")).toBeCloseTo(725, 0); // 22:00, 80th
    expect(timeToScore("run", 1530, "male")).toBeCloseTo(475, 0); // 25:30, 50th
    expect(timeToScore("run", 1860, "male")).toBeCloseTo(125, 0); // 31:00, 5th
  });

  it("fixes the previous 18:30/20:00 gap — a 19:20 finish now lands solidly in Advanced", () => {
    const score = timeToScore("run", 19 * 60 + 20, "male"); // 19:20
    expect(score).toBeGreaterThanOrEqual(725); // Advanced tier floor
  });

  it("still applies the female multiplier on top (no sex-specific run data yet)", () => {
    const male = timeToScore("run", 1320, "male");
    const female = timeToScore("run", 1320, "female");
    expect(female).toBeGreaterThan(male); // same raw time, female scores higher (fairness adjustment)
  });
});
