import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Run 5k anchors, corrected against Run Regimen (runregimen.com) —
 * sex-specific tables using the same 5/20/50/80/95th percentile convention
 * as row/cycle/swim (splitindex_calibration_master.py), single internally-
 * consistent source, high confidence.
 */
describe("timeToScore — run (Run Regimen percentile anchors)", () => {
  it("matches the male percentile anchors", () => {
    expect(timeToScore("run", 973.3, "male")).toBeCloseTo(925, 0); // 16:13.3, 99th
    expect(timeToScore("run", 1060, "male")).toBeCloseTo(850, 0); // 17:40, 95th
    expect(timeToScore("run", 1184, "male")).toBeCloseTo(725, 0); // 19:44, 80th
    expect(timeToScore("run", 1351, "male")).toBeCloseTo(475, 0); // 22:31, 50th
    expect(timeToScore("run", 1579, "male")).toBeCloseTo(250, 0); // 26:19, 20th
    expect(timeToScore("run", 1889, "male")).toBeCloseTo(125, 0); // 31:29, 5th
  });

  it("matches the female percentile anchors", () => {
    expect(timeToScore("run", 1138.1, "female")).toBeCloseTo(925, 0); // 18:58.1, 99th
    expect(timeToScore("run", 1247, "female")).toBeCloseTo(850, 0); // 20:47, 95th
    expect(timeToScore("run", 1384, "female")).toBeCloseTo(725, 0); // 23:04, 80th
    expect(timeToScore("run", 1567, "female")).toBeCloseTo(475, 0); // 26:07, 50th
  });

  it("the originally reported bug case (5.00km/18:25) scores solidly in the Elite range", () => {
    const score = timeToScore("run", 18 * 60 + 25, "male"); // 18:25 = 1105s
    expect(score).toBeGreaterThan(725); // Advanced floor
    expect(score).toBeLessThan(925); // below World Class
  });

  it("a 19:20 finish (his PB) lands solidly inside Advanced", () => {
    const score = timeToScore("run", 19 * 60 + 20, "male");
    expect(score).toBeGreaterThanOrEqual(725);
  });
});
