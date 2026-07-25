import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Run 5k anchors, sourced from the Motera 5k times chart QA reconstruction
 * — matched point-by-point rather than reduced to a handful of tier-
 * boundary anchors. Reverted here from a briefly-tried Run Regimen
 * (single-source, sex-specific, percentile-convention) table after direct
 * comparison — judged Motera's numbers more accurate for run specifically.
 */
describe("timeToScore — run (Motera reconstruction anchors)", () => {
  it("matches the Motera chart's reconstructed scores at its own data points", () => {
    expect(timeToScore("run", 900, "male")).toBeCloseTo(950, 0); // 15:00
    expect(timeToScore("run", 960, "male")).toBeCloseTo(910, 0); // 16:00
    expect(timeToScore("run", 1020, "male")).toBeCloseTo(870, 0); // 17:00
    expect(timeToScore("run", 1050, "male")).toBeCloseTo(850, 0); // 17:30
    expect(timeToScore("run", 1110, "male")).toBeCloseTo(775, 0); // 18:30
    expect(timeToScore("run", 1170, "male")).toBeCloseTo(708.3, 0); // 19:30
    expect(timeToScore("run", 1200, "male")).toBeCloseTo(675, 0); // 20:00
    expect(timeToScore("run", 1350, "male")).toBeCloseTo(575, 0); // 22:30
    expect(timeToScore("run", 1500, "male")).toBeCloseTo(500, 0); // 25:00
    expect(timeToScore("run", 1800, "male")).toBeCloseTo(350, 0); // 30:00
    expect(timeToScore("run", 2400, "male")).toBeCloseTo(200, 0); // 40:00
  });

  it("the originally reported bug case (5.00km/18:25) interpolates close to the chart's own 18:30 anchor", () => {
    const score = timeToScore("run", 18 * 60 + 25, "male"); // 18:25 = 1105s
    expect(score).toBeGreaterThan(775);
    expect(score).toBeLessThan(850);
  });

  it("a 22:22 finish lands close to the 22:30 anchor (575)", () => {
    const score = timeToScore("run", 22 * 60 + 22, "male"); // 22:22 = 1342s
    expect(score).toBeGreaterThan(575);
    expect(score).toBeLessThan(615); // 21:30 anchor
  });

  it("still applies the female multiplier on top (no sex-specific Motera data available)", () => {
    const male = timeToScore("run", 1320, "male");
    const female = timeToScore("run", 1320, "female");
    expect(female).toBeGreaterThan(male); // same raw time, female scores higher (fairness adjustment)
  });
});
