import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Run 5k anchors, recalibrated to the general population of 5K runners
 * rather than competitive/club runners (user feedback: "I want split index
 * scores to be for the average people getting into running not elite
 * athletes"). Cross-referenced public race-result aggregators (PacePercentile.
 * com's aggregate database, RunDida's combined-population table, RunRepeat's
 * 34-million-result "State of Running" study) converge on ~30:00 for the
 * 50th percentile — see the anchor table's own doc comment in
 * cardio-benchmarks.ts for full sourcing. Replaces the prior Motera-chart
 * table, which put the 50th percentile at 25:00 (5-7 minutes faster than
 * population data supports).
 */
describe("timeToScore — run (general-population recalibrated anchors)", () => {
  it("matches its own anchor points exactly", () => {
    expect(timeToScore("run", 1020, "male")).toBeCloseTo(925, 0); // 17:00 — 99th percentile
    expect(timeToScore("run", 1140, "male")).toBeCloseTo(850, 0); // 19:00 — 95th percentile
    expect(timeToScore("run", 1305, "male")).toBeCloseTo(725, 0); // 21:45 — 80th percentile
    expect(timeToScore("run", 1800, "male")).toBeCloseTo(475, 0); // 30:00 — 50th percentile (median)
    expect(timeToScore("run", 2310, "male")).toBeCloseTo(250, 0); // 38:30 — 20th percentile
    expect(timeToScore("run", 2940, "male")).toBeCloseTo(125, 0); // 49:00 — 5th percentile
  });

  it("a genuinely average pace for someone new to running (~30-32 min 5K) now scores near the middle of the scale, not deep in the low range", () => {
    expect(timeToScore("run", 30 * 60, "male")).toBeCloseTo(475, 0);
    const score32 = timeToScore("run", 32 * 60, "male");
    expect(score32).toBeGreaterThan(350);
    expect(score32).toBeLessThan(475);
  });

  it("an exceptional (sub-15:00) time is scored at or near the ceiling, not merely 'very good'", () => {
    expect(timeToScore("run", 900, "male")).toBe(999); // 15:00 — beyond the 99th-percentile anchor
  });

  it("still applies the female multiplier on top (no sex-specific data at this population re-basis either)", () => {
    const male = timeToScore("run", 1320, "male");
    const female = timeToScore("run", 1320, "female");
    expect(female).toBeGreaterThan(male); // same raw time, female scores higher (fairness adjustment)
  });

  it("never returns a score below 0 or above 1000, even for extreme inputs", () => {
    expect(timeToScore("run", 60, "male")).toBeLessThanOrEqual(1000); // absurdly fast
    expect(timeToScore("run", 20000, "male")).toBeGreaterThanOrEqual(0); // absurdly slow
  });
});
