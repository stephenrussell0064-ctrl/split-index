import { describe, expect, it } from "vitest";
import { scoreStrength } from "./split-strength-engine";
import { resolveScoringWeight } from "./weight-entry";

/**
 * 17 Oct 2026, the owner's two numbers, pinned at their bodyweight (78 kg):
 *
 *   "a 140kg bench at 78 bw should score well into the 90s yet it only scores
 *    88.8, the whole bench score system needs to be buffed more"
 *   "pull ups need to be buffed as 20 only scores 75.6 which should be much
 *    higher and around 90"
 *
 * Both reported figures reproduced exactly before the change (888 and 756
 * internal), which is what ties these fixtures to the engine's own output
 * rather than to a guess at the athlete's inputs.
 */
const BODYWEIGHT_KG = 78;

function scoreLogged(exerciseName: string, loggedWeightKg: number, reps: number, bodyweightKg = BODYWEIGHT_KG) {
  const resolved = resolveScoringWeight(loggedWeightKg, exerciseName, undefined);
  return scoreStrength({
    liftKey: exerciseName,
    exerciseName,
    history: [],
    latestSet: { weightKg: resolved.scoringWeightKg, reps },
    bodyweightKg,
    sex: "male",
    age: 30,
    isPremium: false,
    isBodyweightRelative: resolved.isBodyweightRelative,
    weightEntryMode: resolved.mode,
  });
}

describe("bench — the reported 140 kg @ 78 kg = 88.8 case", () => {
  it("reads well into the 90s", () => {
    const result = scoreLogged("Bench Press", 140, 1);
    expect(result.score).toBeGreaterThanOrEqual(930);
    expect(result.score).toBeLessThanOrEqual(945);
    expect(result.tier).toBe("World Class");
  });

  it("buffed the WHOLE curve, not just the top: an ordinary 75 kg bench at 83 kg reads 650", () => {
    expect(scoreLogged("Bench Press", 75, 1, 83).score).toBe(650);
  });

  it("still cannot be pinned at 999 by a working set", () => {
    expect(scoreLogged("Bench Press", 100, 8).score).toBeLessThan(900);
  });
});

describe("pull-ups — the reported 20 reps = 75.6 case", () => {
  it("twenty strict bodyweight pull-ups read around 90", () => {
    const result = scoreLogged("Pull Up", 0, 20);
    expect(result.score).toBeGreaterThanOrEqual(880);
    expect(result.score).toBeLessThanOrEqual(905);
  });

  it("has no ceiling: 25, 30, 40 and 50 reps are four different, rising numbers below 999", () => {
    const scores = [20, 25, 30, 40, 50].map((reps) => scoreLogged("Pull Up", 0, reps).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]!);
    }
    expect(scores[scores.length - 1]).toBeLessThan(999);
  });

  it("one strict pull-up is a Beginner score, not an absence", () => {
    const single = scoreLogged("Pull Up", 0, 1);
    expect(single.flags).not.toContain("no-valid-set");
    expect(single.score).toBe(100);
    expect(single.tier).toBe("Beginner");
  });

  it("the Weighted Pull Up twin shares the table", () => {
    expect(scoreLogged("Weighted Pull Up", 0, 12).score).toBe(scoreLogged("Pull Up", 0, 12).score);
    expect(scoreLogged("Weighted Pull Up", 20, 5).score).toBe(scoreLogged("Pull Up", 20, 5).score);
  });

  it("is monotonic in reps from one to fifty", () => {
    let previous = -1;
    for (let reps = 1; reps <= 50; reps++) {
      const score = scoreLogged("Pull Up", 0, reps).score;
      expect(score, `${reps} reps`).toBeGreaterThan(previous);
      previous = score;
    }
  });
});
