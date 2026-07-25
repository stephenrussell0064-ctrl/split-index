import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * Regression coverage for the monotonicity bug: a session's own pace must
 * always score >= any slower time at the same distance, regardless of
 * multi-session memory, HR, session type, or any other modifier. See
 * CLAUDE-CODE-BRIEF-cardio-session-score-monotonicity-bug.md.
 */
describe("scoreCardioActivity — pace monotonicity", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 5000,
    durationSeconds: 1500,
    sex: "male",
    age: 30,
  };

  it("paceScore is non-increasing as time increases, across the full 5k range (15:00-40:00)", () => {
    const durations: number[] = [];
    for (let s = 900; s <= 2400; s += 15) durations.push(s);

    const paceScores = durations.map(
      (durationSeconds) => scoreCardioActivity({ ...base, durationSeconds }).paceScore
    );

    for (let i = 1; i < paceScores.length; i++) {
      expect(paceScores[i]).toBeLessThanOrEqual(paceScores[i - 1]);
    }
  });

  it("score (with bonuses) is non-increasing as time increases, holding HR/elevation/temperature fixed", () => {
    const durations: number[] = [];
    for (let s = 900; s <= 2400; s += 15) durations.push(s);

    const scores = durations.map(
      (durationSeconds) =>
        scoreCardioActivity({
          ...base,
          durationSeconds,
          avgHR: 175,
          elevationMeters: 30,
          temperatureCelsius: 20,
        }).score
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("never lets multi-session memory override a session's own faster pace (the reported bug)", () => {
    // The reported case: 5.00km in 18:25 (1105s) with a stale, slower stored
    // prediction from prior sessions (~19:53 / 1193.7s equivalent) — this
    // used to score 725 by anchoring to the stale memory instead of this
    // session's own pace. Assert the INVARIANT (memory can't change the
    // outcome), not a hardcoded score range — the exact number depends on
    // whichever anchor table is live (see scoring-calibration-rewrite.md),
    // and re-hardcoding a magic range here would break every recalibration.
    const withStaleMemory = scoreCardioActivity({
      ...base,
      durationSeconds: 1105,
      avgHR: 192,
      elevationMeters: 22,
      temperatureCelsius: 18,
      storedPredictionSeconds: 1193.7,
    });
    const withoutMemory = scoreCardioActivity({
      ...base,
      durationSeconds: 1105,
      avgHR: 192,
      elevationMeters: 22,
      temperatureCelsius: 18,
    });
    expect(withStaleMemory.score).toBe(withoutMemory.score);
    expect(withStaleMemory.paceScore).toBe(withoutMemory.paceScore);

    // A faster session must never score below a slower one, memory or not.
    const slowerResult = scoreCardioActivity({
      ...base,
      durationSeconds: 1110, // 18:30 — slower than the 18:25 case above
      storedPredictionSeconds: 1193.7,
    });
    expect(withStaleMemory.score).toBeGreaterThanOrEqual(slowerResult.score);
  });

  it("a faster time never scores lower than a slower time even at opposite modifier extremes", () => {
    // Worst case for the ±5% cap: the faster session gets every modifier at
    // its most negative, the slower session gets every modifier at its most
    // positive. Faster must still never score lower once paces differ
    // enough (see MAX_MODIFIER_FRACTION in cardio-activity.ts).
    const faster = scoreCardioActivity({
      ...base,
      durationSeconds: 900, // 15:00
      avgHR: 220, // no HR bonus available (near/above reference)
    });
    const slower = scoreCardioActivity({
      ...base,
      durationSeconds: 1800, // 30:00 — much slower
      avgHR: 120,
      elevationMeters: 200,
      temperatureCelsius: 35,
    });

    expect(faster.score).toBeGreaterThan(slower.score);
  });
});
