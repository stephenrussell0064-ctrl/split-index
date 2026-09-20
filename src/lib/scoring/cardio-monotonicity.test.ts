import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput, type RecentCardioSession } from "./cardio-activity";

/**
 * The monotonicity guarantee: a session's population score must always be at
 * least that of any slower time at the same distance, whatever the heart
 * rate, session tag, multi-session memory or history. Originally written for
 * the bug where a stored prediction could out-vote a session's own pace
 * (CLAUDE-CODE-BRIEF-cardio-session-score-monotonicity-bug.md); it survives
 * the two-score rewrite unchanged, because the population score is still one
 * lookup of one number on one table.
 *
 * Volume/terrain/environment/pacing credit lives entirely in the separate
 * `executionScore`, which has no monotonicity constraint of its own.
 */
describe("scoreCardioActivity — population score monotonicity", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 5000,
    durationSeconds: 1500,
    sex: "male",
    age: 30,
  };

  it("is non-increasing as time increases, across the full 5k range (15:00-40:00)", () => {
    const durations: number[] = [];
    for (let s = 900; s <= 2400; s += 15) durations.push(s);

    const scores = durations.map(
      (durationSeconds) => scoreCardioActivity({ ...base, durationSeconds }).score
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("holds at a fixed heart rate too — effort scaling is a multiplier, not a re-ranking", () => {
    const durations: number[] = [];
    for (let s = 1200; s <= 3000; s += 30) durations.push(s);
    const scores = durations.map(
      (durationSeconds) =>
        scoreCardioActivity({
          ...base,
          distanceMeters: 8000,
          durationSeconds,
          avgHR: 145,
          restingHR: 50,
          maxHR: 190,
        }).score
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("is non-increasing as heart rate rises at a fixed pace — the same run at more effort is worth less", () => {
    const scores = [130, 140, 150, 160, 170, 180].map(
      (avgHR) =>
        scoreCardioActivity({
          ...base,
          distanceMeters: 8000,
          durationSeconds: 2560,
          avgHR,
          restingHR: 50,
          maxHR: 190,
        }).score
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("is unaffected by decoupling — pacing quality only ever touches executionScore", () => {
    const bare = scoreCardioActivity({ ...base, durationSeconds: 1200 });
    const faded = scoreCardioActivity({
      ...base,
      durationSeconds: 1200,
      firstHalfAvgHR: 150,
      secondHalfAvgHR: 170,
      firstHalfPaceSecPerKm: 240,
      secondHalfPaceSecPerKm: 260,
    });
    expect(faded.score).toBe(bare.score);
    expect(faded.paceScore).toBe(bare.paceScore);
  });

  it("never lets multi-session memory override a session's own pace (the reported bug)", () => {
    // 5.00km in 18:25 (1105s) with a stale, slower stored prediction from
    // prior sessions (~19:53 / 1193.7s) — this used to score 725 by anchoring
    // to the stale memory instead of the session's own pace. The memory is
    // now a confidence signal and nothing else.
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

    const slower = scoreCardioActivity({
      ...base,
      durationSeconds: 1110,
      avgHR: 192,
      elevationMeters: 22,
      temperatureCelsius: 18,
      storedPredictionSeconds: 1193.7,
    });
    expect(withStaleMemory.score).toBeGreaterThanOrEqual(slower.score);
  });

  it("a genuinely fast effort still out-scores a much slower one at any HR/terrain/weather extreme", () => {
    const faster = scoreCardioActivity({ ...base, durationSeconds: 900, avgHR: 220 });
    const slower = scoreCardioActivity({
      ...base,
      durationSeconds: 1800,
      avgHR: 120,
      elevationMeters: 200,
      temperatureCelsius: 35,
    });
    expect(faster.score).toBeGreaterThan(slower.score);
  });

  it("is unaffected by the athlete's own history — history moves the PERSONAL score, never the population one", () => {
    const session: CardioInput = {
      ...base,
      distanceMeters: 8000,
      durationSeconds: 2560,
      avgHR: 145,
      restingHR: 50,
      maxHR: 190,
      startedAt: "2026-06-01T07:00:00Z",
    };
    const history: RecentCardioSession[] = Array.from({ length: 6 }, (_, i) => ({
      distanceMeters: 8000,
      durationSeconds: 2560,
      avgHR: 145,
      startedAt: new Date(Date.parse("2026-06-01T07:00:00Z") - (i + 1) * 3 * 86_400_000).toISOString(),
    }));

    const alone = scoreCardioActivity(session);
    const withHistory = scoreCardioActivity({ ...session, recentSessions: history });
    expect(withHistory.score).toBe(alone.score);
    expect(alone.personalScore).toBeNull();
    expect(withHistory.personalScore).not.toBeNull();
  });

  it("a long, easy session's executionScore gets full volume/terrain credit independent of its modest population score", () => {
    // The real reported case: a 53:19 easy 10.12km run.
    const easyLongRun = scoreCardioActivity({
      ...base,
      distanceMeters: 10120,
      durationSeconds: 3199,
      avgHR: 174,
      restingHR: 50,
      maxHR: 190,
      elevationMeters: 66,
      temperatureCelsius: 12,
    });
    expect(easyLongRun.executionScore).not.toBeNull();
    expect(easyLongRun.executionScore!).toBeGreaterThan(550);
  });

  it("executionScore never overrides or substitutes for the population score", () => {
    const result = scoreCardioActivity({
      ...base,
      durationSeconds: 1020, // 17:00 — fast
      firstHalfAvgHR: 150,
      secondHalfAvgHR: 190,
      firstHalfPaceSecPerKm: 190,
      secondHalfPaceSecPerKm: 230, // faded hard relative to HR
    });
    expect(result.score).toBe(result.paceScore);
    expect(result.score).toBeGreaterThan(800);
  });
});
