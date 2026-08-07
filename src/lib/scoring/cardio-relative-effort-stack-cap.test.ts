import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * User feedback: a real 19.14km run (1h41m) scored as if its 5K equivalent
 * were ~17:33 (score 904) — implausibly fast for what was, by the athlete's
 * own account, not a race effort. Root cause: several independently-
 * reasoned, independently-capped relative-effort credit mechanisms
 * (HR-zone credit up to 21%, its stacked EF-baseline bonus up to another
 * 20%, and the long-run distance credit up to 18%) all apply multiplicatively
 * to the same sessionEquivalentSeconds for an easy/recovery/long-tagged
 * session — compounding to as much as ~48% off the raw pace-projected time,
 * far beyond what any single mechanism was designed to allow on its own.
 */
describe("scoreCardioActivity — overall stacking cap on relative-effort credit", () => {
  it("caps the combined discount even when every stackable bonus maxes out simultaneously", () => {
    const maximallyStacked: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 19140,
      durationSeconds: 6060, // 1h41m — a real reported case
      sex: "male",
      age: 18,
      maxHR: 206,
      experience: "intermediate",
      avgHR: 128, // deep below-base HR
      sessionType: "easy",
      easyEffortBaselineEF: 0.15, // trivially low baseline — this session "beats" it easily
      easyEffortBaselinePaceSeconds: 1600, // corroborates the below-base HR reading as genuine
    };
    const result = scoreCardioActivity(maximallyStacked);
    expect(result.flags).toContain("relative-effort-discount-capped");

    // The raw (uncredited) Riegel projection at the system default k is the
    // reference point the cap measures against. Lowered from 30% to 25%
    // (user feedback: "the credit for these runs needs to be reduced
    // slightly").
    const rawProjectedSeconds = 6060 * Math.pow(5000 / 19140, 1.08);
    const actualDiscount = 1 - result.predictions!["5000"] / rawProjectedSeconds;
    expect(actualDiscount).toBeLessThanOrEqual(0.26); // 25% cap + small floating-point/age-factor slack
  });

  it("doesn't touch a session where the individual mechanisms never approached the cap", () => {
    const modest: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 8000,
      durationSeconds: 8 * 354, // 5:54/km, moderate easy pace
      sex: "male",
      age: 30,
      restingHR: 50,
      maxHR: 190,
      experience: "intermediate",
      avgHR: 152,
      sessionType: "easy",
    };
    const result = scoreCardioActivity(modest);
    expect(result.flags).not.toContain("relative-effort-discount-capped");
  });

  it("never credits an easy run's equivalent at or faster than the athlete's own demonstrated best, staying a small margin behind it (real-account regression)", () => {
    // Real reported case: 19.14km/1:41:31/166bpm easy run, resting HR 47
    // (genuinely low, so 166bpm reads as "at/below target" for this
    // athlete's own zones) credited all the way to a 17:33 predicted 5K —
    // FASTER than their actual best-ever 5K (18:25). Capping it at exactly
    // the PR (1105s) still read as too generous per follow-up feedback
    // ("this is still too high... credit needs to be reduced slightly"),
    // so the floor sits a small margin (3%) slower than the literal PR —
    // an easy run can approach race fitness, not fully match it.
    const input: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 19140,
      durationSeconds: 6091,
      sex: "male",
      age: 19,
      restingHR: 47,
      maxHR: 205,
      experience: "intermediate",
      avgHR: 166,
      sessionType: "easy",
      elevationMeters: 119,
      temperatureCelsius: 19,
      personalizedRiegelK: 1.087,
      recentHardEffortBenchmarkSeconds: 1105, // their real 18:25 5K PR
    };
    const result = scoreCardioActivity(input);
    expect(result.flags).toContain("relative-effort-capped-at-demonstrated-best");
    // Slower than the PR (never matches or beats it)...
    expect(result.predictions!["5000"]).toBeGreaterThan(1105);
    // ...but still within a modest margin of it, not an arbitrary distance away.
    expect(result.predictions!["5000"]).toBeLessThan(1105 * 1.1);
  });

  it("only caps at the demonstrated best when that evidence is actually on file — no history means no ceiling to apply", () => {
    const noHistory: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 19140,
      durationSeconds: 6091,
      sex: "male",
      age: 19,
      restingHR: 47,
      maxHR: 205,
      experience: "intermediate",
      avgHR: 166,
      sessionType: "easy",
      elevationMeters: 119,
      temperatureCelsius: 19,
    };
    const result = scoreCardioActivity(noHistory);
    expect(result.flags).not.toContain("relative-effort-capped-at-demonstrated-best");
  });

  it("never applies to race/tempo sessions — the cap is scoped to relative-effort (easy/recovery/long) scoring only", () => {
    const race: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1105,
      sex: "male",
      age: 18,
      maxHR: 206,
      experience: "intermediate",
      avgHR: 192,
      sessionType: "race",
    };
    const result = scoreCardioActivity(race);
    expect(result.flags).not.toContain("relative-effort-discount-capped");
  });
});
