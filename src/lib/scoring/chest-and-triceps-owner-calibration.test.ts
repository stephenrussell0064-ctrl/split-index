import { describe, expect, it } from "vitest";
import { scoreStrength } from "./split-strength-engine";
import { resolveScoringWeight } from "./weight-entry";

/**
 * 18 Oct 2026, three reports in one message, all pinned at the owner's 78 kg:
 *
 *   "pec deck is scoring too high. my 130 for 8 scores 99.9 and this is not
 *    right please fix relative to standards"
 *   "weighted dips are too low scoring as well"
 *   "tricep pushdowns are way too low scoring, 45kg for 8 now scores 64.3"
 *
 * Three different causes. The pec deck row IS Strength Level's table and a
 * 130 x 8 set is past their Elite anchor — the defect was the tail above the
 * table running straight into 999. Dips were still on the log formula while
 * their pull-up twin had a table. The pushdown was at exact percentile
 * parity, which the owner had already overruled for the single-arm version.
 */
const BODYWEIGHT_KG = 78;

function scoreLogged(exerciseName: string, loggedWeightKg: number, reps: number, age: number | null = 30, bodyweightKg = BODYWEIGHT_KG) {
  const resolved = resolveScoringWeight(loggedWeightKg, exerciseName, undefined);
  return scoreStrength({
    liftKey: exerciseName,
    exerciseName,
    history: [],
    latestSet: { weightKg: resolved.scoringWeightKg, reps },
    bodyweightKg,
    sex: "male",
    age,
    isPremium: false,
    isBodyweightRelative: resolved.isBodyweightRelative,
    weightEntryMode: resolved.mode,
  });
}

describe("above the top anchor the curve tapers instead of running to 999", () => {
  it("a lift a third of a step past Elite reads in the 960s, not 984, and never 999 with age credit", () => {
    // Lat pulldown 145 kg at 83 kg: 12 kg past the 133 kg Elite anchor.
    const peak = scoreLogged("Lat Pulldown", 145, 1, 30, 83);
    expect(peak.score).toBeGreaterThanOrEqual(955);
    expect(peak.score).toBeLessThanOrEqual(972);
    for (const age of [40, 45, 50, 60]) {
      expect(scoreLogged("Lat Pulldown", 145, 1, age, 83).score, `age ${age}`).toBeLessThan(999);
    }
  });

  it("one Advanced-to-Elite step past Elite earns ~63% of the headroom (bench 118 -> 151 -> 184 kg at 83 kg)", () => {
    const score = scoreLogged("Bench Press", 184, 1, 30, 83).score;
    expect(score).toBeGreaterThanOrEqual(978);
    expect(score).toBeLessThanOrEqual(984);
  });

  it("two full steps past Elite still rounds below 999 — only a record-class lift gets there", () => {
    // Bench at 83 kg: Advanced 118, Elite 151, so two steps past is 217 kg.
    // The tail reaches 999 only by rounding, more than four steps out.
    expect(scoreLogged("Bench Press", 217, 1, 30, 83).score).toBeLessThan(999);
    // Pec deck at 83 kg: Advanced 148, Elite 188, so two steps past is 268 kg.
    expect(scoreLogged("Pec Deck", 268, 1, 30, 83).score).toBeLessThan(999);
  });
});

describe("pec deck — the reported 130 x 8 = 99.9 case, re-dictated to ~90", () => {
  it("reads around 89 at 78 kg", () => {
    const result = scoreLogged("Pec Deck", 130, 8);
    expect(result.score).toBeGreaterThanOrEqual(880);
    expect(result.score).toBeLessThanOrEqual(900);
  });

  it("reads below the owner's bench, at every age", () => {
    for (const age of [null, 30, 40, 50]) {
      expect(scoreLogged("Pec Deck", 130, 8, age).score, `age ${age}`).toBeLessThan(
        scoreLogged("Bench Press", 140, 1, age).score
      );
    }
  });

  it("kept the curve's shape: an ordinary 80 x 10 is a Semi-Pro set, not a Beginner one", () => {
    const score = scoreLogged("Pec Deck", 80, 10).score;
    expect(score).toBeGreaterThanOrEqual(620);
    expect(score).toBeLessThanOrEqual(670);
  });

  it("still rises past the anchor — the tail is a taper, not a clamp", () => {
    const a = scoreLogged("Pec Deck", 120, 8).score;
    const b = scoreLogged("Pec Deck", 130, 8).score;
    const c = scoreLogged("Pec Deck", 140, 8).score;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("two-arm tricep pushdown — the reported 45 x 8 = 64.3 case", () => {
  it("reads ~85, on the same dictated curve as the single-arm pushdown", () => {
    const result = scoreLogged("Tricep Pushdown", 45, 8);
    expect(result.score).toBeGreaterThanOrEqual(840);
    expect(result.score).toBeLessThanOrEqual(865);
  });

  it("a load split across two hands scores what it scores in one (the 0.55 relationship)", () => {
    // Two-arm 50 kg x 8 against single-arm 27.5 kg x 8: within the rounding
    // of the two tables' five anchors.
    const twoArm = scoreLogged("Tricep Pushdown", 50, 8).score;
    const oneArm = scoreLogged("Single Arm Tricep Pushdown", 27.5, 8).score;
    expect(Math.abs(twoArm - oneArm)).toBeLessThanOrEqual(15);
  });

  it("an ordinary 60 x 10 working set does not pin the scale", () => {
    expect(scoreLogged("Tricep Pushdown", 60, 10).score).toBeLessThan(930);
  });
});

describe("dips — scored against the pull-up table at Strength Level's 1.5x", () => {
  it("+30 kg x 8 reads in the 750s, up from 629", () => {
    const result = scoreLogged("Weighted Dips", 30, 8);
    expect(result.score).toBeGreaterThanOrEqual(745);
    expect(result.score).toBeLessThanOrEqual(772);
  });

  it("Dip and Weighted Dips share the table", () => {
    expect(scoreLogged("Dip", 30, 8).score).toBe(scoreLogged("Weighted Dips", 30, 8).score);
    expect(scoreLogged("Dip", 0, 12).score).toBe(scoreLogged("Weighted Dips", 0, 12).score);
  });

  it("the same reps score lower on dips than on pull-ups, and the same added load too", () => {
    for (const reps of [5, 10, 20, 30]) {
      expect(scoreLogged("Dip", 0, reps).score, `${reps} reps`).toBeLessThan(scoreLogged("Pull Up", 0, reps).score);
    }
    expect(scoreLogged("Weighted Dips", 30, 8).score).toBeLessThan(scoreLogged("Weighted Pull Up", 30, 8).score);
  });

  it("is monotonic in reps from one to fifty, starting at a Beginner score rather than an absence", () => {
    const single = scoreLogged("Dip", 0, 1);
    expect(single.flags).not.toContain("no-valid-set");
    expect(single.tier).toBe("Beginner");
    let previous = -1;
    for (let reps = 1; reps <= 50; reps++) {
      const score = scoreLogged("Dip", 0, reps).score;
      expect(score, `${reps} reps`).toBeGreaterThan(previous);
      previous = score;
    }
  });
});
