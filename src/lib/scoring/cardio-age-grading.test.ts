import { describe, expect, it } from "vitest";
import { enduranceAgeGradeFactor } from "./cardio-benchmarks";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

describe("enduranceAgeGradeFactor", () => {
  it("is a flat 1.0 peak plateau for under-35s (juniors are never inflated)", () => {
    expect(enduranceAgeGradeFactor(18)).toBe(1.0);
    expect(enduranceAgeGradeFactor(25)).toBe(1.0);
    expect(enduranceAgeGradeFactor(35)).toBe(1.0);
    expect(enduranceAgeGradeFactor(null)).toBe(1.0);
    expect(enduranceAgeGradeFactor(undefined)).toBe(1.0);
  });

  it("credits masters with a factor below 1 that shrinks with age", () => {
    expect(enduranceAgeGradeFactor(40)).toBeLessThan(1.0);
    expect(enduranceAgeGradeFactor(60)).toBeLessThan(enduranceAgeGradeFactor(40));
    expect(enduranceAgeGradeFactor(40)).toBeCloseTo(0.97, 5);
    expect(enduranceAgeGradeFactor(50)).toBeCloseTo(0.89, 5);
  });

  it("clamps beyond the top of the table rather than extrapolating to zero", () => {
    expect(enduranceAgeGradeFactor(95)).toBe(enduranceAgeGradeFactor(80));
    expect(enduranceAgeGradeFactor(80)).toBeCloseTo(0.6, 5);
  });
});

describe("scoreCardioActivity — age grading", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 5000,
    durationSeconds: 1350, // ~22:30 5k
    sex: "male",
    age: 30,
  };

  it("leaves a young athlete's score unchanged and does not flag age grading", () => {
    const young = scoreCardioActivity({ ...base, age: 18 });
    const peak = scoreCardioActivity({ ...base, age: 30 });
    expect(young.score).toBe(peak.score);
    expect(young.flags).not.toContain("age-graded");
  });

  it("scores a masters athlete higher than a peak athlete for the same time", () => {
    const peak = scoreCardioActivity({ ...base, age: 30 });
    const masters = scoreCardioActivity({ ...base, age: 55 });
    expect(masters.score).toBeGreaterThan(peak.score);
    expect(masters.flags).toContain("age-graded");
  });
});
