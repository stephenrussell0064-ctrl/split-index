import { describe, expect, it } from "vitest";
import { scoreCardioActivity, riegelPredictions, type CardioInput } from "./cardio-activity";

/**
 * User feedback: "half marathon and marathon split score predictions are
 * very off when logging activities... make them inline with 5km and 10km
 * scores." Follow-up clarification from the same user: Riegel's formula
 * assumes whatever pace/duration it's fed was run flat-out — so an easy run
 * needs to be converted to its flat-out-equivalent pace before being handed
 * to Riegel, not fed in raw.
 *
 * Root cause: `scoreCardioActivity`'s `predictions` field fed the RAW
 * input.distanceMeters/durationSeconds into riegelPredictions/
 * sportRacePredictions — the athlete's actual (deliberately slow) easy pace
 * — instead of `anchorSeconds`, the same effort/HR-adjusted
 * benchmark-equivalent time the session's own score is built from. Because
 * Riegel's exponent scales with the distance ratio, a constant pacing
 * error is small at 5K/10K (close to most logged distances) but balloons at
 * half/marathon (4-8x the distance) — exactly the "5K/10K read fine,
 * half/marathon are very off" pattern reported.
 */
describe("scoreCardioActivity predictions — anchored on effort-adjusted equivalent, not raw easy pace", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 12000,
    durationSeconds: 66 * 60, // 5:30/km — a deliberately easy pace
    sex: "male",
    age: 30,
    restingHR: 50,
    maxHR: 190,
    avgHR: 138, // comfortably below this athlete's base HR zone
    experience: "intermediate",
    sessionType: "easy",
  };

  it("predicts materially faster half-marathon/marathon times than raw-pace Riegel would, for a genuinely easy HR-zone-scored run", () => {
    const rawPaceLadder = riegelPredictions(base.distanceMeters, base.durationSeconds, base.experience)!;
    const result = scoreCardioActivity(base);
    expect(result.flags).toContain("hr-zone-scored");
    expect(result.predictions).not.toBeNull();

    // The half-marathon/marathon entries should read meaningfully faster
    // (closer to this athlete's true fitness) than naively stretching the
    // easy pace out to those distances — this is the actual bug being fixed.
    expect(result.predictions!["21097.5"]).toBeLessThan(rawPaceLadder["21097.5"]);
    expect(result.predictions!["42195"]).toBeLessThan(rawPaceLadder["42195"]);
  });

  it("keeps the ladder internally consistent — each longer distance still takes strictly more time", () => {
    const result = scoreCardioActivity(base);
    const entries = Object.entries(result.predictions!)
      .map(([d, s]) => [Number(d), s] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i][1]).toBeGreaterThan(entries[i - 1][1]);
    }
  });

  it("stays close to raw-pace Riegel for a genuine race-pace effort at the benchmark distance (5K), within the existing HR-adjustment cap", () => {
    const raceEffort: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 22.5 * 60, // 22:30 5K, race effort — no easy tag
      sex: "male",
      age: 30,
      restingHR: 50,
      maxHR: 190,
      avgHR: 165,
      experience: "intermediate",
    };
    const rawPaceLadder = riegelPredictions(raceEffort.distanceMeters, raceEffort.durationSeconds, raceEffort.experience)!;
    const result = scoreCardioActivity(raceEffort);
    // Not tagged as an easy/recovery/long session, so no relative-effort
    // credit applies — the only thing that can move the anchor away from
    // raw-pace Riegel here is the existing population HR adjustment
    // (already capped at +/-10% pre-fix, unrelated to this change), so the
    // gap should never exceed that cap.
    for (const dist of Object.keys(rawPaceLadder)) {
      const diffFraction = Math.abs(result.predictions![dist] - rawPaceLadder[dist]) / rawPaceLadder[dist];
      expect(diffFraction).toBeLessThan(0.1);
    }
  });

  it("returns null predictions when there's no valid distance/duration to anchor on", () => {
    const empty: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 0,
      durationSeconds: 0,
      sex: "male",
      age: 30,
    };
    expect(scoreCardioActivity(empty).predictions).toBeNull();
  });
});
