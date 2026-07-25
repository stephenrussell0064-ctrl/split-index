import { describe, expect, it } from "vitest";
import { scoreStrength, type ScoreStrengthInput } from "./split-strength-engine";

/**
 * Part G (scoring-calibration-rewrite): corrected bench/deadlift anchors,
 * sourced from Strength Level's general standards mapped through
 * percentile-framework.ts. These two lifts are scored via a real anchor
 * table now, not the single-anchorRatio log formula the other ~20 lifts
 * still use.
 *
 * A single logged set at reps=1 gives an estimated 1RM exactly equal to the
 * weight lifted (both epley1RM and brzycki1RM special-case effective reps
 * === 1 to return the raw weight, no formula/multiplier applied), so this
 * cleanly isolates the anchor-table calibration from the 1RM-estimation
 * formula (pre-existing, untouched by this brief).
 */
function scoreAtOneRM(liftKey: string, targetOneRMKg: number, overrides: Partial<ScoreStrengthInput> = {}) {
  return scoreStrength({
    liftKey,
    history: [],
    latestSet: { weightKg: targetOneRMKg, reps: 1 },
    bodyweightKg: 83,
    sex: "male",
    age: 30,
    isPremium: false,
    ...overrides,
  });
}

describe("scoreStrength — bench/deadlift corrected anchors (Part G)", () => {
  it("bench: 140kg @ 83kg BW now scores ~752 (Advanced), not 850 (Elite)", () => {
    const result = scoreAtOneRM("bench", 140);
    expect(result.score).toBeCloseTo(752, -1); // within ~10 points
    expect(result.tier).toBe("Advanced");
  });

  it("bench matches the Strength Level anchor points exactly", () => {
    expect(scoreAtOneRM("bench", 47).score).toBeCloseTo(125, 0);
    expect(scoreAtOneRM("bench", 70).score).toBeCloseTo(250, 0);
    expect(scoreAtOneRM("bench", 98).score).toBeCloseTo(475, 0);
    expect(scoreAtOneRM("bench", 132).score).toBeCloseTo(725, 0);
    expect(scoreAtOneRM("bench", 169).score).toBeCloseTo(850, 0);
  });

  it("deadlift: 200kg @ 83kg BW now scores 725 (Advanced), not 770", () => {
    const result = scoreAtOneRM("deadlift", 200);
    expect(result.score).toBeCloseTo(725, 0);
    expect(result.tier).toBe("Advanced");
  });

  it("deadlift matches the Strength Level anchor points exactly", () => {
    expect(scoreAtOneRM("deadlift", 78).score).toBeCloseTo(125, 0);
    expect(scoreAtOneRM("deadlift", 112).score).toBeCloseTo(250, 0);
    expect(scoreAtOneRM("deadlift", 152).score).toBeCloseTo(475, 0);
    expect(scoreAtOneRM("deadlift", 200).score).toBeCloseTo(725, 0);
    expect(scoreAtOneRM("deadlift", 250).score).toBeCloseTo(850, 0);
  });

  it("is monotonic — a heavier lift never scores lower than a lighter one", () => {
    const weights = [30, 47, 60, 70, 85, 98, 115, 132, 150, 169, 190];
    const scores = weights.map((w) => scoreAtOneRM("bench", w).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it("still applies sex/age adjustment on top of the anchor table", () => {
    const male = scoreAtOneRM("bench", 98);
    const female = scoreAtOneRM("bench", 98, { sex: "female" });
    const older = scoreAtOneRM("bench", 98, { age: 55 });
    expect(female.score).toBeGreaterThan(male.score); // same raw lift, female scores higher (fairness adjustment)
    expect(older.score).toBeGreaterThan(male.score); // same raw lift, older scores higher (age credit)
  });

  it("nextTier still resolves to a sensible kg target for anchor-table lifts", () => {
    const result = scoreAtOneRM("bench", 90); // between 70 (250) and 98 (475) anchors — Beginner/Intermediate band
    expect(result.nextTier).not.toBeNull();
    expect(result.nextTier!.kgNeeded).toBeGreaterThan(0);
  });

  it("other lifts (no anchor table yet) are unaffected — still use the log formula", () => {
    const result = scoreAtOneRM("squat", 150);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(999);
  });
});
