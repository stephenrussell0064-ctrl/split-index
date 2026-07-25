import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * Regression coverage for the monotonicity bug: a session's own pace must
 * always score >= any slower time at the same distance, regardless of
 * multi-session memory, HR, session type, or any other modifier. See
 * CLAUDE-CODE-BRIEF-cardio-session-score-monotonicity-bug.md.
 *
 * `score` (= `paceScore`) is monotonic BY CONSTRUCTION — nothing is ever
 * added on top of it. Volume/terrain/environment/pacing credit lives
 * entirely in the separate `executionScore`, which has no monotonicity
 * constraint of its own (it's explicitly allowed to vary independently).
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

  it("score (= paceScore) is non-increasing as time increases, across the full 5k range (15:00-40:00)", () => {
    const durations: number[] = [];
    for (let s = 900; s <= 2400; s += 15) durations.push(s);

    const scores = durations.map(
      (durationSeconds) => scoreCardioActivity({ ...base, durationSeconds }).score
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("score is unaffected by elevation/temperature/decoupling — those only ever touch executionScore", () => {
    // avgHR is deliberately excluded here — it legitimately affects
    // paceScore via the HR-adjusted benchmark-equivalent projection itself
    // (a lower-HR session at the same pace yields a faster, better
    // equivalent — that's part of computing the session's own pace, not a
    // modifier bolted on afterward). Elevation/temperature/decoupling are
    // the ones that must never touch it.
    const bare = scoreCardioActivity({ ...base, durationSeconds: 1200 });
    const loaded = scoreCardioActivity({
      ...base,
      durationSeconds: 1200,
      elevationMeters: 500,
      temperatureCelsius: 40,
      firstHalfAvgHR: 150,
      secondHalfAvgHR: 170,
      firstHalfPaceSecPerKm: 240,
      secondHalfPaceSecPerKm: 260,
    });
    expect(loaded.score).toBe(bare.score);
    expect(loaded.paceScore).toBe(bare.paceScore);
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

  it("a faster time never scores lower than a slower time even at opposite HR/elevation/temperature extremes", () => {
    const faster = scoreCardioActivity({
      ...base,
      durationSeconds: 900, // 15:00
      avgHR: 220,
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

  it("a long, easy, low-HR session's executionScore gets full volume/terrain credit, independent of its (modest) pace score", () => {
    // Regression: an earlier fix bolted volume/terrain credit onto the
    // primary score and capped the combined modifier at ±5% of paceScore to
    // guarantee monotonicity — but that made the *absolute* bonus scale
    // with how fast the pace read, crushing exactly the long/easy/low-HR
    // sessions the bonus exists to credit. The fix is architectural, not a
    // bigger cap: volume/terrain credit now lives entirely in
    // executionScore, which never touches the monotonic `score`. Reproduces
    // the real reported case: a 53:19 easy 10.12km run.
    const easyLongRun = scoreCardioActivity({
      ...base,
      distanceMeters: 10120,
      durationSeconds: 3199, // 53:19
      avgHR: 174,
      elevationMeters: 66,
      temperatureCelsius: 12,
    });
    // score (paceScore) itself is modest, reflecting genuine easy pace —
    // that's correct and expected, not a bug.
    expect(easyLongRun.score).toBeLessThan(600);
    // executionScore credits the long/hilly session well above neutral (500).
    expect(easyLongRun.executionScore).not.toBeNull();
    expect(easyLongRun.executionScore!).toBeGreaterThan(550);
  });

  it("executionScore never overrides or substitutes for score/paceScore", () => {
    // A short, fast, badly-executed (faded hard) session should still have
    // a high pace score even if its executionScore is mediocre.
    const result = scoreCardioActivity({
      ...base,
      durationSeconds: 1020, // 17:00 — fast
      firstHalfAvgHR: 150,
      secondHalfAvgHR: 190,
      firstHalfPaceSecPerKm: 190,
      secondHalfPaceSecPerKm: 230, // faded hard relative to HR
    });
    expect(result.score).toBe(result.paceScore);
    expect(result.score).toBeGreaterThan(800); // fast pace still reads as fast
  });
});
