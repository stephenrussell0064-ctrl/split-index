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
    // reference point the cap measures against.
    const rawProjectedSeconds = 6060 * Math.pow(5000 / 19140, 1.08);
    const actualDiscount = 1 - result.predictions!["5000"] / rawProjectedSeconds;
    expect(actualDiscount).toBeLessThanOrEqual(0.31); // 30% cap + small floating-point/age-factor slack
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
