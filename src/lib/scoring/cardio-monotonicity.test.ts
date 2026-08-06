import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";
import {
  personalEasyEffortBaselineEF,
  personalRecentHardEffortBenchmarkSeconds,
  type EasyEffortSession,
} from "./cardio-predictions";

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

/**
 * Relative-effort scoring for easy/recovery/long-tagged sessions (user
 * feedback: easy runs should score off how efficient THIS session was
 * relative to this athlete's own typical easy effort, not off absolute
 * pace-vs-benchmark — see personalEasyEffortBaselineEF in
 * cardio-predictions.ts and the scoreCardioActivity branch that applies it).
 */
describe("scoreCardioActivity — relative-effort scoring for easy/recovery/long sessions", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 8000,
    durationSeconds: 2880, // 48:00 — deliberately easy pace
    sex: "male",
    age: 30,
  };

  const baselineSessions: EasyEffortSession[] = Array.from({ length: 3 }, () => ({
    distanceMeters: 8000,
    durationSeconds: 2880,
    avgHR: 140,
    sessionType: "easy",
  }));
  const baselineEF = personalEasyEffortBaselineEF("run", baselineSessions);

  it("personalEasyEffortBaselineEF requires at least 3 qualifying sessions", () => {
    expect(personalEasyEffortBaselineEF("run", baselineSessions.slice(0, 2))).toBeNull();
    expect(baselineEF).not.toBeNull();
    expect(baselineEF).toBeGreaterThan(0);
  });

  it("personalEasyEffortBaselineEF ignores non-easy session types", () => {
    const mixed: EasyEffortSession[] = [
      ...baselineSessions,
      { distanceMeters: 5000, durationSeconds: 1000, avgHR: 190, sessionType: "race" },
    ];
    expect(personalEasyEffortBaselineEF("run", mixed)).toBe(baselineEF);
  });

  it("personalEasyEffortBaselineEF excludes sessions that look like mistagged hard efforts from the pool", () => {
    // A near-race-pace 5k tagged "easy" (mirrors the reported case) should
    // NOT drag the baseline up — it's excluded from the average entirely,
    // same guard as scoring a session directly.
    const withMistaggedSession: EasyEffortSession[] = [
      ...baselineSessions,
      { distanceMeters: 5000, durationSeconds: 1160, avgHR: 188, sessionType: "easy" }, // 19:20 5k tagged easy
      { distanceMeters: 5000, durationSeconds: 1151, avgHR: 188, sessionType: "race" }, // establishes the hard-effort reference
    ];
    const contaminated = personalEasyEffortBaselineEF("run", withMistaggedSession);
    expect(contaminated).toBe(baselineEF);
  });

  it("falls back to population scoring (plus the baseline-independent long-run distance credit) when no personal baseline is available yet", () => {
    const withoutBaseline = scoreCardioActivity({
      ...base,
      avgHR: 140,
      sessionType: "easy",
    });
    const asRace = scoreCardioActivity({
      ...base,
      avgHR: 140,
      sessionType: "race",
    });
    // No baseline-driven relative-effort credit fires without a baseline...
    expect(withoutBaseline.flags).not.toContain("relative-effort-scored");
    // ...but the long-run distance credit (user feedback: "the longer you
    // run, the harder it is at any split" — see longRunDistanceCredit)
    // applies to any easy/recovery/long-tagged session independent of
    // whether a personal baseline exists yet, so this can score AT LEAST as
    // well as the identical race-tagged session — bonus-only, same
    // philosophy as every other easy-session credit in this file.
    expect(withoutBaseline.score).toBeGreaterThanOrEqual(asRace.score);
  });

  it("never applies relative-effort scoring to race/tempo/threshold sessions, even if a baseline is supplied", () => {
    const asRaceWithBaseline = scoreCardioActivity({
      ...base,
      avgHR: 140,
      sessionType: "race",
      easyEffortBaselineEF: baselineEF,
    });
    const asRaceWithoutBaseline = scoreCardioActivity({
      ...base,
      avgHR: 140,
      sessionType: "race",
    });
    expect(asRaceWithBaseline.score).toBe(asRaceWithoutBaseline.score);
    expect(asRaceWithBaseline.flags).not.toContain("relative-effort-scored");
  });

  it("scores an easy session relative to the athlete's own baseline — bonus-only: more efficient than usual scores higher, less efficient never scores lower than standard scoring", () => {
    // Same distance/duration as the baseline sessions (so pace is identical
    // across all three) — only avgHR differs, isolating relative efficiency.
    const atBaseline = scoreCardioActivity({
      ...base,
      avgHR: 140, // exactly the baseline HR -> efficiency ratio 1.0, no bonus
      sessionType: "easy",
      easyEffortBaselineEF: baselineEF,
    });
    const moreEfficient = scoreCardioActivity({
      ...base,
      avgHR: 120, // same pace, lower HR -> better efficiency than baseline -> bonus
      sessionType: "easy",
      easyEffortBaselineEF: baselineEF,
    });
    const lessEfficient = scoreCardioActivity({
      ...base,
      avgHR: 160, // same pace, higher HR -> worse efficiency than baseline -> no penalty
      sessionType: "easy",
      easyEffortBaselineEF: baselineEF,
    });
    const lessEfficientNoBaseline = scoreCardioActivity({
      ...base,
      avgHR: 160,
      sessionType: "easy",
    });

    expect(atBaseline.flags).not.toContain("relative-effort-scored");
    expect(moreEfficient.flags).toContain("relative-effort-scored");
    expect(moreEfficient.score).toBeGreaterThan(atBaseline.score);
    // Below-baseline efficiency is NEVER penalized relative to standard
    // scoring — it just doesn't earn the bonus (bonus-only, same philosophy
    // as the population HR adjustment above).
    expect(lessEfficient.score).toBe(lessEfficientNoBaseline.score);
    expect(lessEfficient.flags).not.toContain("relative-effort-scored");
  });

  it("is still monotonic for a fixed baseline — a faster easy run never scores lower than a slower one", () => {
    const durations: number[] = [];
    for (let s = 2400; s <= 3600; s += 60) durations.push(s);

    const scores = durations.map(
      (durationSeconds) =>
        scoreCardioActivity({
          ...base,
          durationSeconds,
          avgHR: 140,
          sessionType: "easy",
          easyEffortBaselineEF: baselineEF,
        }).score
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("caps the relative-effort adjustment at ±20%, however extreme the efficiency ratio", () => {
    // Ratio ~3.5x baseline (avgHR 40) vs. exactly at the +20% cap boundary
    // (avgHR chosen so ratio is exactly 1.2) — both should clamp to the same
    // adjustment and therefore produce the identical score.
    const extremeRatio = scoreCardioActivity({
      ...base,
      avgHR: 40,
      sessionType: "easy",
      easyEffortBaselineEF: baselineEF,
    });
    const atCapBoundary = scoreCardioActivity({
      ...base,
      avgHR: 140 / 1.2, // efficiency ratio exactly 1.2 relative to baseline
      sessionType: "easy",
      easyEffortBaselineEF: baselineEF,
    });
    expect(extremeRatio.score).toBe(atCapBoundary.score);
  });
});

/**
 * Mistag guard: a session tagged easy/recovery/long whose own pace is
 * suspiciously close to the athlete's fastest recent hard-effort pace is
 * more likely a hard effort logged with the wrong tag than a genuine easy
 * run — relative-effort scoring should fall back to standard scoring for
 * it, rather than amplifying an already-fast, mistagged session further.
 * Reproduces the real case found when reviewing this feature: a 5.00km in
 * 19:20 (essentially race pace) logged as "easy".
 */
describe("scoreCardioActivity — mistag guard for relative-effort scoring", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 0,
    durationSeconds: 0,
    sex: "male",
    age: 30,
  };

  const easyBaselineSessions: EasyEffortSession[] = Array.from({ length: 3 }, () => ({
    distanceMeters: 8000,
    durationSeconds: 2880, // 48:00 easy pace
    avgHR: 140,
    sessionType: "easy",
  }));
  const easyBaselineEF = personalEasyEffortBaselineEF("run", easyBaselineSessions)!;

  const hardEffortHistory: EasyEffortSession[] = [
    { distanceMeters: 5000, durationSeconds: 1151, sessionType: "race" }, // 19:11 5k
    { distanceMeters: 5000, durationSeconds: 1160, sessionType: "race" }, // 19:20 5k
  ];
  const hardEffortReferenceSeconds = personalRecentHardEffortBenchmarkSeconds(
    "run",
    hardEffortHistory
  )!;

  it("personalRecentHardEffortBenchmarkSeconds returns the fastest recent race/tempo/threshold projection", () => {
    expect(hardEffortReferenceSeconds).not.toBeNull();
    expect(hardEffortReferenceSeconds).toBeLessThanOrEqual(1151);
  });

  it("returns null with no qualifying hard-effort history, or for walk", () => {
    expect(personalRecentHardEffortBenchmarkSeconds("run", easyBaselineSessions)).toBeNull();
    expect(personalRecentHardEffortBenchmarkSeconds("walk", hardEffortHistory)).toBeNull();
  });

  it("falls back to standard scoring for a fast run mistagged easy, instead of amplifying it further", () => {
    // 5.00km in 19:20 (1160s) tagged "easy" — essentially this athlete's own
    // race pace, per hardEffortHistory above.
    const mistagged = scoreCardioActivity({
      ...base,
      distanceMeters: 5000,
      durationSeconds: 1160,
      avgHR: 188,
      sessionType: "easy",
      easyEffortBaselineEF: easyBaselineEF,
      recentHardEffortBenchmarkSeconds: hardEffortReferenceSeconds,
    });
    const sameSessionNoGuardData = scoreCardioActivity({
      ...base,
      distanceMeters: 5000,
      durationSeconds: 1160,
      avgHR: 188,
      sessionType: "easy",
      easyEffortBaselineEF: easyBaselineEF,
      // recentHardEffortBenchmarkSeconds omitted — simulates no hard-effort
      // history yet, so the guard can't engage and relative-effort scoring
      // applies unchecked.
    });

    expect(mistagged.flags).toContain("easy-tag-pace-mismatch");
    expect(mistagged.flags).not.toContain("relative-effort-scored");
    // Without the guard, this same fast/mistagged session would have been
    // amplified well above its standard pace-vs-benchmark score.
    expect(sameSessionNoGuardData.flags).toContain("relative-effort-scored");
    expect(sameSessionNoGuardData.score).toBeGreaterThan(mistagged.score);
  });

  it("a genuine easy run well below the athlete's hard-effort pace is unaffected by the guard", () => {
    const genuineEasy = scoreCardioActivity({
      ...base,
      distanceMeters: 8000,
      durationSeconds: 2880, // 48:00 — nowhere near 19-20min 5k race pace
      avgHR: 120, // better efficiency than the 140bpm baseline -> earns the bonus
      sessionType: "easy",
      easyEffortBaselineEF: easyBaselineEF,
      recentHardEffortBenchmarkSeconds: hardEffortReferenceSeconds,
    });
    expect(genuineEasy.flags).not.toContain("easy-tag-pace-mismatch");
    expect(genuineEasy.flags).toContain("relative-effort-scored");
  });
});

/**
 * Terrain/heat credit for relative-effort scoring (user feedback: elevation
 * and temperature should genuinely affect easy/recovery/long scoring, not
 * just the secondary executionScore — a hilly/hot easy run at a given pace/
 * HR is a harder effort than a flat/cool one). Bonus-only, same philosophy
 * as the rest of relative-effort scoring, and applied identically to the
 * personal baseline itself (personalEasyEffortBaselineEF) so both sides of
 * the comparison stay normalized the same way.
 */
describe("scoreCardioActivity — terrain/heat credit for relative-effort scoring", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 8000,
    durationSeconds: 2880, // 48:00 easy pace
    sex: "male",
    age: 30,
  };

  const flatCoolBaselineSessions: EasyEffortSession[] = Array.from({ length: 3 }, () => ({
    distanceMeters: 8000,
    durationSeconds: 2880,
    avgHR: 140,
    sessionType: "easy",
  }));
  const flatCoolBaselineEF = personalEasyEffortBaselineEF("run", flatCoolBaselineSessions)!;

  it("a hilly/hot easy run at the same pace/HR as the baseline earns more credit than a flat/cool one", () => {
    const flatCool = scoreCardioActivity({
      ...base,
      avgHR: 140,
      sessionType: "easy",
      easyEffortBaselineEF: flatCoolBaselineEF,
    });
    const hillyHot = scoreCardioActivity({
      ...base,
      avgHR: 140,
      sessionType: "easy",
      easyEffortBaselineEF: flatCoolBaselineEF,
      elevationMeters: 400, // genuinely hilly for 8km
      temperatureCelsius: 32, // genuinely hot
    });

    expect(flatCool.flags).not.toContain("relative-effort-scored"); // exactly at baseline, no terrain/heat credit -> no bonus
    expect(hillyHot.flags).toContain("relative-effort-scored");
    expect(hillyHot.score).toBeGreaterThan(flatCool.score);
  });

  it("elevation/temperature alone never penalize — a flat/cool run never scores worse for lacking terrain/heat credit", () => {
    const flatCool = scoreCardioActivity({
      ...base,
      avgHR: 150, // slightly below baseline efficiency
      sessionType: "easy",
      easyEffortBaselineEF: flatCoolBaselineEF,
    });
    const flatCoolExplicit = scoreCardioActivity({
      ...base,
      avgHR: 150,
      sessionType: "easy",
      easyEffortBaselineEF: flatCoolBaselineEF,
      elevationMeters: 0,
      temperatureCelsius: 12, // exactly the comfort reference -> zero heat credit
    });
    expect(flatCoolExplicit.score).toBe(flatCool.score);
  });

  it("personalEasyEffortBaselineEF normalizes baseline sessions for terrain/heat too, not just the session being scored", () => {
    // A baseline built from genuinely hilly/hot sessions should read as a
    // HIGHER bar (terrain/heat-credited EF), same as scoring a session
    // directly — otherwise a hilly baseline would make it artificially easy
    // to "beat" with a flat, easy session of otherwise-equal raw EF.
    const hillyHotBaselineSessions: EasyEffortSession[] = Array.from({ length: 3 }, () => ({
      distanceMeters: 8000,
      durationSeconds: 2880,
      avgHR: 140,
      sessionType: "easy",
      elevationMeters: 400,
      temperatureCelsius: 32,
    }));
    const hillyHotBaselineEF = personalEasyEffortBaselineEF("run", hillyHotBaselineSessions)!;
    expect(hillyHotBaselineEF).toBeGreaterThan(flatCoolBaselineEF);
  });
});
