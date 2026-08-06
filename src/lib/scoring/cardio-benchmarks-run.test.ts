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

  it("an exceptional (sub-15:00) time scores very high but doesn't hit the 999 ceiling — that's reserved for the actual world record", () => {
    // See the 999-reserved-for-world-record tests below: 15:00 is a
    // genuinely outstanding time but nowhere near the men's 5K world
    // record (12:49), so it approaches but doesn't reach 999.
    const score = timeToScore("run", 900, "male"); // 15:00
    expect(score).toBeGreaterThan(950);
    expect(score).toBeLessThan(999);
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

/**
 * 999 reserved for the actual world record (user feedback: "make a rule
 * where 999 is never achieved unless this is a world record for age and
 * gender") — not for extrapolating the fast-end anchor slope indefinitely.
 * Checked against each sex's own real record directly (Berihu Aregawi's
 * 12:49 men's 5K road record, Beatrice Chebet's 13:54 women's), not the
 * population female factor, since the real male/female gap narrows at the
 * elite tail. "...for age" comes for free from the caller's existing
 * age-grading (enduranceAgeGradeFactor) multiplying the time before it
 * reaches timeToScore — this test file calls timeToScore directly (no age
 * grading applied), so it's exercising the open/absolute record.
 */
describe("timeToScore — run world-record ceiling", () => {
  it("only reaches 999 at or beyond the men's 5K world record (12:49)", () => {
    expect(timeToScore("run", 12 * 60 + 49, "male")).toBe(999); // exact record
    expect(timeToScore("run", 12 * 60 + 48, "male")).toBe(999); // beats it
    expect(timeToScore("run", 12 * 60 + 50, "male")).toBeLessThan(999); // one second slower
  });

  it("only reaches 999 at or beyond the women's 5K world record (13:54)", () => {
    expect(timeToScore("run", 13 * 60 + 54, "female")).toBe(999);
    expect(timeToScore("run", 14 * 60, "female")).toBeLessThan(999);
  });

  it("approaches 999 smoothly as the time nears the record, rather than jumping", () => {
    const scores = [16 * 60, 15 * 60, 14 * 60, 13 * 60].map((s) => timeToScore("run", s, "male"));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
      expect(scores[i]).toBeLessThanOrEqual(999);
    }
  });
});
