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
 *
 * A separate demonstrated-best ceiling (floor at this athlete's own recent
 * race pace) was tried and reverted (user feedback: "i dont want a ceiling
 * in place, i want the natural credit reduced slightly on every run") — it
 * fixed the one reported case but made every session that hit it converge
 * on the identical number regardless of how different their actual paces
 * were. This stack cap alone is the mechanism now — lowered progressively
 * across rounds of real-data feedback: 0.30 -> 0.25 -> 0.20.
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
    expect(actualDiscount).toBeLessThanOrEqual(0.21); // 20% cap + small floating-point/age-factor slack
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

  it("different easy/long sessions still land on different numbers — no shared ceiling to converge on", () => {
    // Direct check against the specific complaint that motivated reverting
    // the demonstrated-best ceiling: two genuinely different sessions
    // (different distance, pace, and HR) should score differently, not
    // collapse onto the same capped value.
    const base = {
      type: "run" as const,
      benchmarkSport: "run" as const,
      sex: "male" as const,
      age: 19,
      restingHR: 47,
      maxHR: 205,
      experience: "intermediate" as const,
      sessionType: "easy" as const,
      personalizedRiegelK: 1.087,
      recentHardEffortBenchmarkSeconds: 1105, // their real 18:25 5K PR — informational only, no longer a hard ceiling
    };
    const nineteenKm = scoreCardioActivity({ ...base, distanceMeters: 19140, durationSeconds: 6091, avgHR: 166 });
    const twelveKm = scoreCardioActivity({ ...base, distanceMeters: 12520, durationSeconds: 3929, avgHR: 166 });
    expect(nineteenKm.predictions!["5000"]).not.toBeCloseTo(twelveKm.predictions!["5000"], 0);
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
